'use strict';

const express = require('express');
const request = require('supertest');

const mockPf = {
  resolveUserSubject: jest.fn(),
  resolveConfig: jest.fn(),
  getActorToken: jest.fn(),
  performExchange: jest.fn(),
  validateIntermediateToken: jest.fn(),
  validateFinalToken: jest.fn(),
};
jest.mock('../../services/pfStandardTokenExchangeService', () => mockPf);
jest.mock('../../services/mcpToolAuthorizationService', () => ({
  resolveExpectedMcpResourceUri: () => 'https://mcp.example.test/mcp',
}));

const { createPfAiAgentRouter } = require('../../routes/pfAiAgent');

const jwt = (claims) => `${Buffer.from('{"alg":"RS256","typ":"at+jwt"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const config = { agentActorScope: 'agent:invoke', mcpActorScope: 'mcp:invoke', intermediateAudience: 'https://agent.example.test', issuer: 'https://pf.example.test' };

function appWith(session) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/api/pf-ai-agent', createPfAiAgentRouter({ configStore: { getEffective: () => '' }, fetchImpl: jest.fn() }));
  return app;
}
const pfSession = () => ({
  oauthProvider: 'pingfederate',
  oauthTokens: { accessToken: jwt({ sub: 'demouser' }) },
  pfAiAgent: {},
});

describe('PF RFC 8693 playground exchange', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPf.resolveConfig.mockReturnValue(config);
    mockPf.resolveUserSubject.mockReturnValue('demouser');
    mockPf.getActorToken.mockResolvedValueOnce('agent-actor').mockResolvedValueOnce('mcp-actor');
  });

  test('hop 1 returns claims only and keeps the token in the session', async () => {
    const intermediate = jwt({ iss: config.issuer, sub: 'demouser', aud: config.intermediateAudience, scope: 'agent:invoke', act: { sub: 'agent' } });
    mockPf.performExchange.mockResolvedValue(intermediate);
    const session = pfSession();

    const res = await request(appWith(session)).post('/api/pf-ai-agent/token-exchange/agent').expect(200);

    expect(res.body.claims).toEqual(expect.objectContaining({ sub: 'demouser', act: { sub: 'agent' } }));
    expect(JSON.stringify(res.body)).not.toContain(intermediate);
    expect(mockPf.validateIntermediateToken).toHaveBeenCalled();
    expect(session.pfAiAgent.exchangeDemo.intermediate).toBe(intermediate);
  });

  test('hop 2 needs hop 1, then returns the nested act chain and clears the stored token', async () => {
    const session = pfSession();
    const app = appWith(session);
    await request(app).post('/api/pf-ai-agent/token-exchange/mcp').expect(409);

    mockPf.performExchange.mockResolvedValueOnce(jwt({ sub: 'demouser' })).mockResolvedValueOnce(
      jwt({ sub: 'demouser', aud: 'https://mcp.example.test/mcp', act: { sub: 'mcp', act: { sub: 'agent' } } }));
    await request(app).post('/api/pf-ai-agent/token-exchange/agent').expect(200);
    const res = await request(app).post('/api/pf-ai-agent/token-exchange/mcp').expect(200);

    expect(res.body.claims.act).toEqual({ sub: 'mcp', act: { sub: 'agent' } });
    expect(mockPf.validateFinalToken).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ audience: 'https://mcp.example.test/mcp' }));
    expect(session.pfAiAgent.exchangeDemo).toBeUndefined();
  });

  test('a PingOne session is refused and PingFederate is never called', async () => {
    const session = { ...pfSession(), oauthProvider: 'pingone' };
    const res = await request(appWith(session)).post('/api/pf-ai-agent/token-exchange/agent').expect(409);
    expect(res.body.error).toBe('PF_AI_EXCHANGE_PF_SESSION_REQUIRED');
    expect(mockPf.performExchange).not.toHaveBeenCalled();
  });

  test('an opaque (reference) PF access token is explained, not reported as "no user"', async () => {
    const session = { ...pfSession(), oauthTokens: { accessToken: 'opaque-reference-token' } };
    const res = await request(appWith(session)).post('/api/pf-ai-agent/token-exchange/agent').expect(409);

    expect(res.body.error).toBe('PF_AI_EXCHANGE_OPAQUE_TOKEN');
    expect(res.body.detail).toMatch(/opaque/i);
    expect(res.body.detail).toMatch(/JWT access token/);
    expect(JSON.stringify(res.body)).not.toContain('opaque-reference-token');
    expect(mockPf.performExchange).not.toHaveBeenCalled();
  });

  test('a JWT with no sub or Username says which claims are missing', async () => {
    mockPf.resolveUserSubject.mockReturnValue(null);
    const session = { ...pfSession(), oauthTokens: { accessToken: jwt({ iss: 'https://pf.example.test' }) } };
    const res = await request(appWith(session)).post('/api/pf-ai-agent/token-exchange/agent').expect(409);

    expect(res.body.error).toBe('PF_AI_EXCHANGE_USER_UNKNOWN');
    expect(res.body.detail).toMatch(/neither a sub nor a Username claim/);
  });

  test('missing PF configuration answers 503 with the setting names', async () => {
    mockPf.resolveConfig.mockImplementation(() => { throw Object.assign(new Error('Missing: PF_TOKEN_ENDPOINT'), { isConfigError: true }); });
    const res = await request(appWith(pfSession())).post('/api/pf-ai-agent/token-exchange/agent').expect(503);
    expect(res.body).toEqual({ error: 'PF_AI_EXCHANGE_NOT_CONFIGURED', detail: 'Missing: PF_TOKEN_ENDPOINT' });
  });
});
