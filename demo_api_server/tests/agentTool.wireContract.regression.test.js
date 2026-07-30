'use strict';

/**
 * Canary: /internal/agent-tool rejects MCP/JSON-RPC-shaped bodies.
 * demo_agent_service must POST { tool, args, sessionId }. #1108 briefly sent
 * { jsonrpc, method:'tools/call', params:{ name, arguments, sessionId } } and
 * every AG-UI tool call failed with 400 tool_required.
 */

const express = require('express');
const supertest = require('supertest');

jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn().mockResolvedValue(JSON.stringify({ ok: true })),
}));
jest.mock('../services/a2aDelegationService', () => ({
  isA2aEnabled: () => false,
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionStore = {
      get: (_id, cb) => cb(null, { user: { id: 'u1' }, oauthTokens: { accessToken: 'tok' } }),
    };
    next();
  });
  app.use('/internal', require('../routes/agentTool'));
  return app;
}

describe('/internal/agent-tool wire contract', () => {
  const post = (body) =>
    supertest(buildApp())
      .post('/internal/agent-tool')
      .set('x-internal-gateway-secret', 'dev-shared-secret-change-me')
      .send(body);

  it('accepts { tool, args, sessionId }', async () => {
    const res = await post({ tool: 'get_my_accounts', args: {}, sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ ok: true });
  });

  it('rejects JSON-RPC tools/call body with tool_required (not silent success)', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: {}, sessionId: 's1' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tool_required');
  });
});
