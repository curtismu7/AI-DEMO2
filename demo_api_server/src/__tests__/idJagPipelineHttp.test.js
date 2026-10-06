'use strict';

const express = require('express');
const request = require('supertest');
afterEach(() => require('../../services/bffMcpToolExecutor').setPipelineDeps(null));

test.each(['id_jag_login_required', 'id_jag_provider_required', 'id_jag_provider_mismatch'])(
  'real pipeline and executor preserve %s as HTTP 401 with a recoverable target', async (code) => {
    const guardError = Object.assign(new Error('Start the live ID-JAG run.'), {
      code, httpStatus: 401, loginTarget: '/pingfederate-id-jag/demo',
      tokenEvents: [{ id: 'id-jag-guard', status: 'blocked' }],
    });
    const resolveMcpAccessTokenWithEvents = jest.fn(async () => { throw guardError; });
    const callToolLocal = jest.fn();
    const callToolViaGateway = jest.fn();
    require('../../services/bffMcpToolExecutor').setPipelineDeps({
      resolveMcpAccessTokenWithEvents,
      callToolLocal,
      callToolViaGateway,
      publishTokenEventsToSse: jest.fn(),
      emit: jest.fn(),
      config: { useGateway: true },
    });
    const app = express();
    const sessionId = `id-jag-pipeline-${code}`;
    app.use(express.json());
    app.use((req, _res, next) => {
      req.sessionStore = { get: (_id, cb) => cb(null, {
        user: { id: 'user-1' }, oauthType: 'user', oauthProvider: 'pingfederate',
        oauthTokens: { accessToken: 'user-token' },
      }) };
      const run = require('../../services/agentRunContext').setRunContext(sessionId, {
        useCaseId: 'enterprise-managed-mcp-authorization',
      });
      run.toolNames = ['get_my_accounts'];
      next();
    });
    app.use('/internal', require('../../routes/agentTool'));
    const res = await request(app).post('/internal/agent-tool')
      .set('x-internal-gateway-secret', 'dev-shared-secret-change-me')
      .send({ sessionId, tool: 'get_my_accounts', args: {} });
    expect(resolveMcpAccessTokenWithEvents).toHaveBeenCalledTimes(1);
    expect(callToolLocal).not.toHaveBeenCalled();
    expect(callToolViaGateway).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: code, loginTarget: '/pingfederate-id-jag/demo',
      tokenEvents: [{ id: 'id-jag-guard', status: 'blocked' }] });
  },
);
