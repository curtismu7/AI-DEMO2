'use strict';

/**
 * Regression: an AG-UI run's flowTraceId must reach /internal/agent-tool even
 * when the STORED session no longer carries it.
 *
 * agentRun used to pass the trace to the agent's tool callback through the
 * express session. The session is last-write-wins: the mode picker's
 * POST /api/langchain/config loads the session, awaits configStore, then saves
 * its stale copy — landing after agentRun's save and erasing agentRunFlowTraceId.
 * The tool call then ran with no trace, published every pipeline phase to
 * nowhere, and the flow panel showed prompt + reply with no hops (seen live on a
 * cold llama.cpp run, 2026-09-11). The stored session below is exactly what that
 * losing save leaves behind.
 */

const express = require('express');
const supertest = require('supertest');

const mockExecuteBffTool = jest.fn().mockResolvedValue(JSON.stringify({ success: true, data: { ok: 1 } }));
jest.mock('../services/bffMcpToolExecutor', () => ({
  executeBffTool: (...a) => mockExecuteBffTool(...a),
}));

const { setRunContext, getRunContext, clearRunContext } = require('../services/agentRunContext');

// What the session store holds after a concurrent request saved its stale copy.
const STORED_SESSION = {
  user: { id: 'user-1' },
  oauthTokens: { accessToken: 'tok' },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionStore = { get: (_id, cb) => cb(null, { ...STORED_SESSION }) };
    next();
  });
  app.use('/internal', require('../routes/agentTool'));
  return app;
}

const post = (app, body) =>
  supertest(app)
    .post('/internal/agent-tool')
    .set('x-internal-gateway-secret', 'dev-shared-secret-change-me')
    .send(body);

describe('/internal/agent-tool — run context survives a lost session write', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("forwards the run's flowTraceId and useCaseId even though the stored session lost them", async () => {
    // agentRun attaches the run's offered tools to the same entry.
    setRunContext('s-race', { flowTraceId: 'trace-race-1', useCaseId: 'account-summary' }).toolNames = ['get_my_accounts'];

    const res = await post(buildApp(), { tool: 'get_my_accounts', args: {}, sessionId: 's-race' });

    expect(res.status).toBe(200);
    expect(mockExecuteBffTool).toHaveBeenCalledTimes(1);
    const { req } = mockExecuteBffTool.mock.calls[0][0];
    expect(req.body).toEqual({ flowTraceId: 'trace-race-1', useCaseId: 'account-summary' });
  });
});

describe('agentRunContext — one entry per run in flight', () => {
  it('a later run replaces the previous context — no stale useCaseId carries over', () => {
    setRunContext('s-rules', { flowTraceId: 'trace-1', useCaseId: 'step-up-required' });
    setRunContext('s-rules', { flowTraceId: 'trace-2', useCaseId: '' });
    expect(getRunContext('s-rules')).toEqual({ flowTraceId: 'trace-2', useCaseId: null });
  });

  // Entries must not outlive their run (Greptile P2 on #3135): /api/agent/run is
  // reachable by guests and outside the rate limiter, so a never-cleared map
  // would grow with every session that ever ran the agent.
  it('clearing an older run is a no-op once a newer run in the session replaced it', () => {
    const older = setRunContext('s-clear', { flowTraceId: 'trace-old' });
    const newer = setRunContext('s-clear', { flowTraceId: 'trace-new' });

    clearRunContext('s-clear', older);
    expect(getRunContext('s-clear').flowTraceId).toBe('trace-new');

    clearRunContext('s-clear', newer);
    expect(getRunContext('s-clear')).toEqual({ flowTraceId: null, useCaseId: null });
  });

  it('returns an empty context for a session that never ran the agent', () => {
    expect(getRunContext('s-never')).toEqual({ flowTraceId: null, useCaseId: null });
  });
});
