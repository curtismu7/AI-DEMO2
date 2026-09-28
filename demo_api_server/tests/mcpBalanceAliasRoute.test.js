'use strict';

jest.mock('../services/mcpToolPipeline', () => ({
  runMcpToolPipeline: jest.fn(async () => ({
    kind: 'result',
    httpStatus: 200,
    body: { result: { accounts: [] }, tokenEvents: [] },
  })),
}));

const { runMcpToolPipeline } = require('../services/mcpToolPipeline');
const app = require('../server');

function getMcpToolHandler() {
  const routeLayer = app._router.stack.find(
    (layer) => layer.route?.path === '/api/mcp/tool' && layer.route.methods.post,
  );
  return routeLayer.route.stack.at(-1).handle;
}

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    on: jest.fn(),
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('POST /api/mcp/tool banking balance alias', () => {
  const previousIntentSecret = process.env.INTENT_TOKEN_SECRET;

  beforeEach(() => runMcpToolPipeline.mockClear());
  afterAll(() => {
    if (previousIntentSecret === undefined) delete process.env.INTENT_TOKEN_SECRET;
    else process.env.INTENT_TOKEN_SECRET = previousIntentSecret;
  });

  test('forwards banking.get_balance to the registered no-argument account tool', async () => {
    process.env.INTENT_TOKEN_SECRET = 'route-test-intent-secret';
    const handler = getMcpToolHandler();
    const req = {
      headers: { 'user-agent': 'jest', 'content-type': 'application/json', 'content-length': '65' },
      body: { tool: 'banking.get_balance', params: {}, vertical: 'banking' },
      readableLength: 0,
      sessionID: 'test-session',
      session: { id: 'test-session', user: { id: 'test-user' } },
    };
    const res = makeResponse();

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(runMcpToolPipeline).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'get_my_accounts',
      params: {},
      vertical: 'banking',
    }));

    const [{ req: pipelineReq }] = runMcpToolPipeline.mock.calls[0];
    const intentClaims = JSON.parse(Buffer.from(pipelineReq.intentToken.split('.')[1], 'base64url').toString('utf8'));
    expect(intentClaims).toMatchObject({ intent: 'view_balance', confidence: 0.97 });
    expect(intentClaims.permitted_tools).toContain('get_my_accounts');
  });
});
