'use strict';

/**
 * /internal/agent-tool — A2A fast-path parity with the heuristic dispatcher.
 *
 * An a2aDelegated tool (scope-topology) is DENIED for the generalist alone by
 * design (McpFirstTool: a2a-delegation-required). The heuristic path
 * (demoAgentLangGraphService.dispatchVerticalIntent) routes such tools through
 * the RFC 8693 nested-act delegation service BEFORE any direct call. External
 * LLM agents (langchain_agent et al.) call back through this endpoint and used
 * to skip that — the DENY became the final chat reply ("The request was denied
 * by an authorization policy."). The route must delegate instead.
 */

const express = require('express');
const supertest = require('supertest');

const mockExecuteBffTool = jest.fn().mockResolvedValue(JSON.stringify({ success: true, data: { ok: 1 } }));
jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffTool: (...a) => mockExecuteBffTool(...a),
}));

const mockExecuteA2aDelegation = jest.fn().mockResolvedValue(JSON.stringify({
  delegated: true,
  specialist: 'Records Specialist',
  vertical: 'healthcare',
  tool: 'sensitive_patient_records',
  actChainDepth: 2,
  result: { success: true },
  toolError: null,
}));
jest.mock('../services/demoAgentLangGraphService', () => ({
  executeA2aDelegation: (...a) => mockExecuteA2aDelegation(...a),
}));

const SESSION = {
  user: { id: 'user-1' },
  oauthTokens: { accessToken: 'tok' },
  agentRunFlowTraceId: null,
  agentRunUseCaseId: null,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionStore = { get: (_id, cb) => cb(null, { ...SESSION }) };
    next();
  });
  // Fresh require so route module picks up mocks.
  const router = require('../routes/agentTool');
  app.use('/internal', router);
  return app;
}

describe('/internal/agent-tool — A2A fast-path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const post = (app, body) =>
    supertest(app)
      .post('/internal/agent-tool')
      .set('x-internal-gateway-secret', 'dev-shared-secret-change-me')
      .send(body);

  it('routes an a2aDelegated tool through the delegation service, not executeBffTool', async () => {
    const app = buildApp();
    const res = await post(app, { tool: 'sensitive_patient_records', args: {}, sessionId: 's1' });

    expect(res.status).toBe(200);
    expect(mockExecuteA2aDelegation).toHaveBeenCalledTimes(1);
    const [vertical, callArgs] = mockExecuteA2aDelegation.mock.calls[0];
    expect(vertical).toBe('healthcare');
    expect(callArgs).toMatchObject({ tool: 'sensitive_patient_records' });
    expect(mockExecuteBffTool).not.toHaveBeenCalled();
    expect(res.body.result).toMatchObject({ delegated: true, actChainDepth: 2 });
  });

  // RED PROOF for 2026-08-29: delegate_to_specialist is the delegation TRIGGER,
  // not an a2aDelegated tool, so verticalForA2aTool() never matched it and it
  // fell through to executeBffTool — landing on the a2a overlay's fallback
  // executeTool, which answers "must be handled by the A2A interception". The
  // AG-UI agent (demo_agent_service calls this endpoint for every tool) emitted
  // the tool call and nothing performed the handoff.
  it('routes delegate_to_specialist through the delegation service using the session vertical', async () => {
    const app = buildApp();
    const res = await post(app, {
      tool: 'delegate_to_specialist',
      args: { subtask: 'get my portfolio summary' },
      sessionId: 's1',
    });

    expect(res.status).toBe(200);
    expect(mockExecuteBffTool).not.toHaveBeenCalled();
    expect(mockExecuteA2aDelegation).toHaveBeenCalledTimes(1);
    const [vertical, callArgs] = mockExecuteA2aDelegation.mock.calls[0];
    // Session carries no active_vertical here, so the documented default holds.
    expect(vertical).toBe('banking');
    // The trigger's args are passed straight through — NOT wrapped as
    // { tool, args }, which is the shape only a direct a2aDelegated tool uses.
    expect(callArgs).toEqual({ subtask: 'get my portfolio summary' });
    expect(callArgs.tool).toBeUndefined();
  });

  it('delegate_to_specialist follows the session active_vertical when set', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.sessionStore = { get: (_id, cb) => cb(null, { ...SESSION, active_vertical: 'healthcare' }) };
      next();
    });
    app.use('/internal', require('../routes/agentTool'));

    const res = await post(app, { tool: 'delegate_to_specialist', args: {}, sessionId: 's1' });

    expect(res.status).toBe(200);
    expect(mockExecuteA2aDelegation).toHaveBeenCalledTimes(1);
    expect(mockExecuteA2aDelegation.mock.calls[0][0]).toBe('healthcare');
  });

  it('leaves ordinary tools on the direct executeBffTool path', async () => {
    const app = buildApp();
    const res = await post(app, { tool: 'get_my_accounts', args: {}, sessionId: 's1' });

    expect(res.status).toBe(200);
    expect(mockExecuteBffTool).toHaveBeenCalledTimes(1);
    expect(mockExecuteA2aDelegation).not.toHaveBeenCalled();
  });

});
