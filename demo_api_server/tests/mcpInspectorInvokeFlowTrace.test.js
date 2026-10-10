'use strict';

/**
 * @file mcpInspectorInvokeFlowTrace.test.js
 * @description POST /api/mcp/inspector/invoke accepts a flowTraceId, claims it for
 * the session (mcpFlowSseHub.ensurePostTrace) and passes an emit through to
 * mcpCallToolWithFrames — the channel the Inspector page uses to receive
 * elicitation_requested mid-call while the POST is still in flight. Without it,
 * an eliciting tool would leave the Inspector hanging for the 60s elicitation
 * window with no UI (the agent lane shows its modal; the Inspector had nothing).
 */

const express = require('express');
const request = require('supertest');

const mockCallToolWithFrames = jest.fn();
jest.mock('../services/mcpWebSocketClient', () => ({
  ...jest.requireActual('../services/mcpWebSocketClient'),
  mcpCallToolWithFrames: (...args) => mockCallToolWithFrames(...args),
}));

const mockResolve = jest.fn();
jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: (...args) => mockResolve(...args),
}));

jest.mock('../services/mcpFlowSseHub', () => ({
  ensurePostTrace: jest.fn(() => 'ok'),
  publish: jest.fn(),
}));

// setup.js afterEach() runs jest.resetModules() — module-level requires go stale after
// the first test. Re-require per test so the route and the mock share one registry.
let ensurePostTrace;
let publish;
let mcpInspectorRoutes;

function testSession(req, res, next) {
  req.session = { user: { id: 'u-1' }, oauthTokens: { accessToken: 'sess-tok' } };
  req.sessionID = 'sid-1';
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(testSession);
  app.use('/api/mcp/inspector', mcpInspectorRoutes);
  return app;
}

const SESSION_BEARER = () => true;

describe('POST /api/mcp/inspector/invoke — flowTraceId claim + emit relay', () => {
  let app;

  beforeEach(() => {
    ({ ensurePostTrace, publish } = require('../services/mcpFlowSseHub'));
    mcpInspectorRoutes = require('../routes/mcpInspector');
    app = buildApp();
    mockCallToolWithFrames.mockReset();
    mockResolve.mockReset();
    ensurePostTrace.mockReset();
    ensurePostTrace.mockReturnValue('ok');
    publish.mockClear();
    mockResolve.mockResolvedValue({ token: 't', userSub: 'u', tokenEvents: [] });
    mockCallToolWithFrames.mockResolvedValue({ result: { ok: true }, frames: {} });
    // getSessionBearerForMcp is imported into the route module from configStore;
    // default export path requires the config store — provide the bearer via the
    // same session the route reads.
  });

  it('claims the flowTraceId and passes an emit to mcpCallToolWithFrames', async () => {
    const res = await request(app)
      .post('/api/mcp/inspector/invoke')
      .send({ tool: 'get_my_accounts', params: {}, flowTraceId: 'trace-1' });
    if (res.status !== 200) require('fs').appendFileSync('/tmp/flowtrace-debug.log', JSON.stringify(res.body) + '\n');

    expect(res.status).toBe(200);
    expect(ensurePostTrace).toHaveBeenCalledWith('trace-1', 'sid-1');
    const opts = mockCallToolWithFrames.mock.calls[0][5];
    expect(opts).toBeDefined();
    expect(typeof opts.emit).toBe('function');
  });

  it('rejects a flowTraceId the hub refuses for this session', async () => {
    ensurePostTrace.mockImplementation((id, sid) => {
      require('fs').appendFileSync('/tmp/flowtrace-debug.log', 't2 call id=' + id + ' sid=' + sid + '\n');
      return 'forbidden';
    });
    require('fs').appendFileSync('/tmp/flowtrace-debug.log', 'armed\n');
    const res = await request(app)
      .post('/api/mcp/inspector/invoke')
      .send({ tool: 'get_my_accounts', params: {}, flowTraceId: 'other-session-trace' });
    if (res.status !== 403) require('fs').appendFileSync('/tmp/flowtrace-debug.log', JSON.stringify(res.body) + '\n');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid_flow_trace');
    expect(mockCallToolWithFrames).not.toHaveBeenCalled();
  });

  it('omits opts (no emit) when no flowTraceId is sent — existing callers unchanged', async () => {
    const res = await request(app)
      .post('/api/mcp/inspector/invoke')
      .send({ tool: 'get_my_accounts', params: {} });

    expect(res.status).toBe(200);
    expect(ensurePostTrace).not.toHaveBeenCalled();
    expect(mockCallToolWithFrames.mock.calls[0][5]).toBeUndefined();
  });
});
