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

// What the session store holds after a concurrent request saved its stale copy.
const STORED_SESSION = {
  user: { id: 'user-1' },
  oauthTokens: { accessToken: 'tok' },
};

function buildApp(storedSession = STORED_SESSION) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionStore = { get: (_id, cb) => cb(null, { ...storedSession }) };
    next();
  });
  app.use('/internal', require('../routes/agentTool'));
  return app;
}

// setup.js calls jest.resetModules() after every test, so the route loads a
// fresh agentRunContext each test. Take it from the same registry as the route
// (inside the test, after buildApp) or the entry lands in a Map it never reads.
const runContext = () => require('../services/agentRunContext');

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
    const app = buildApp();
    // agentRun attaches the run's offered tools to the same entry.
    runContext().setRunContext('s-race', { flowTraceId: 'trace-race-1', useCaseId: 'account-summary' }).toolNames = ['get_my_accounts'];

    const res = await post(app, { tool: 'get_my_accounts', args: {}, sessionId: 's-race' });

    expect(res.status).toBe(200);
    expect(mockExecuteBffTool).toHaveBeenCalledTimes(1);
    const { req } = mockExecuteBffTool.mock.calls[0][0];
    expect(req.body).toEqual({ flowTraceId: 'trace-race-1', useCaseId: 'account-summary' });
  });

  // agentRun minted this run's Intent Token onto req.session, which is only
  // persisted when the run's response ENDS — so the mid-run tool call read the
  // PREVIOUS run's token from the store, and that end-of-run save also wrote the
  // run's stale session copy over anything saved meanwhile (a mode change).
  it("forwards this run's Intent Token, not a stale one left in the stored session", async () => {
    const app = buildApp({ ...STORED_SESSION, intentToken: 'intent-token-previous-run' });
    const entry = runContext().setRunContext('s-intent', { flowTraceId: 'trace-intent-1' });
    entry.toolNames = ['get_my_accounts'];
    entry.intentToken = 'intent-token-this-run';

    const res = await post(app, { tool: 'get_my_accounts', args: {}, sessionId: 's-intent' });

    expect({ status: res.status, error: res.body && res.body.error }).toEqual({ status: 200, error: undefined });
    const { req } = mockExecuteBffTool.mock.calls[0][0];
    expect(req.intentToken).toBe('intent-token-this-run');
    expect(req.body).toEqual({ flowTraceId: 'trace-intent-1', useCaseId: null });
  });

  // Greptile P1 on #3141: two overlapping runs in one browser session shared one
  // session-keyed context, so the older run's tool callback read the newer run's
  // Intent Token and offered-tool list. The callback now names its run.
  it("gives an overlapping run's tool callback its own run context", async () => {
    const app = buildApp();
    const { setRunContext } = runContext();
    const older = setRunContext('s-overlap', { flowTraceId: 'trace-A', runId: 'run-A' });
    older.toolNames = ['get_my_accounts'];
    older.intentToken = 'intent-A';
    const newer = setRunContext('s-overlap', { flowTraceId: 'trace-B', runId: 'run-B' });
    newer.toolNames = ['get_my_transactions'];
    newer.intentToken = 'intent-B';

    const res = await post(app, { tool: 'get_my_accounts', args: {}, sessionId: 's-overlap', runId: 'run-A' });

    expect({ status: res.status, error: res.body && res.body.error }).toEqual({ status: 200, error: undefined });
    const { req } = mockExecuteBffTool.mock.calls[0][0];
    expect(req.intentToken).toBe('intent-A');
    expect(req.body).toEqual({ flowTraceId: 'trace-A', useCaseId: null });
  });

  it("refuses a callback that names a run that is no longer in flight", async () => {
    const app = buildApp();
    const { setRunContext, clearRunContext } = runContext();
    const ended = setRunContext('s-ended', { runId: 'run-old' });
    ended.toolNames = ['get_my_accounts'];
    clearRunContext('s-ended', ended);
    setRunContext('s-ended', { runId: 'run-new' }).toolNames = ['get_my_accounts'];

    const res = await post(app, { tool: 'get_my_accounts', args: {}, sessionId: 's-ended', runId: 'run-old' });

    expect({ status: res.status, error: res.body && res.body.error }).toEqual({ status: 403, error: 'tool_not_offered' });
  });
});

describe('agentRunContext — one entry per run in flight', () => {
  it('a later run replaces the previous context — no stale useCaseId carries over', () => {
    const { setRunContext, getRunContext } = runContext();
    setRunContext('s-rules', { flowTraceId: 'trace-1', useCaseId: 'step-up-required' });
    setRunContext('s-rules', { flowTraceId: 'trace-2', useCaseId: '' });
    expect(getRunContext('s-rules')).toEqual({ flowTraceId: 'trace-2', useCaseId: null });
  });

  // Entries must not outlive their run (Greptile P2 on #3135): /api/agent/run is
  // reachable by guests and outside the rate limiter, so a never-cleared map
  // would grow with every session that ever ran the agent.
  it('clearing an older run is a no-op once a newer run in the session replaced it', () => {
    const { setRunContext, getRunContext, clearRunContext } = runContext();
    const older = setRunContext('s-clear', { flowTraceId: 'trace-old' });
    const newer = setRunContext('s-clear', { flowTraceId: 'trace-new' });

    clearRunContext('s-clear', older);
    expect(getRunContext('s-clear').flowTraceId).toBe('trace-new');

    clearRunContext('s-clear', newer);
    expect(getRunContext('s-clear')).toEqual({ flowTraceId: null, useCaseId: null });
  });

  it('returns an empty context for a session that never ran the agent', () => {
    expect(runContext().getRunContext('s-never')).toEqual({ flowTraceId: null, useCaseId: null });
  });
});
