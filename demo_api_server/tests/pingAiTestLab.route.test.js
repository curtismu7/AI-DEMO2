const request = require('supertest');
const express = require('express');

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => null),
  get: jest.fn(() => null),
  ensureInitialized: jest.fn(async () => {}),
}));

jest.mock('../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(async () => []),
  callTool: jest.fn(async () => ({ content: [] })),
}));

const pingAiTestLabRoutes = require('../routes/pingAiTestLab');

const app = express();
app.use(express.json());
app.use('/api/admin/ping-ai-test-lab', pingAiTestLabRoutes);

describe('GET /api/admin/ping-ai-test-lab/suites', () => {
  it('returns the three demo-readiness suites', async () => {
    const res = await request(app).get('/api/admin/ping-ai-test-lab/suites');
    expect(res.status).toBe(200);
    expect(res.body.suites.map((s) => s.key)).toEqual(['stack', 'mcp', 'usecases']);
    expect(res.body.evalRowCount).toBeUndefined();
    const stack = res.body.suites.find((s) => s.key === 'stack');
    expect(stack.tests.map((t) => t.key)).toEqual(expect.arrayContaining([
      'conn_pingcli',
      'conn_demo_mcp',
      'conn_mcp_gateway',
      'conn_langchain_agent',
    ]));
    expect(stack.tests.map((t) => t.key)).not.toEqual(expect.arrayContaining([
      'skills_catalog',
      'conn_aic_mcp',
      'conn_davinci_mcp',
    ]));
    const usecases = res.body.suites.find((s) => s.key === 'usecases');
    expect(usecases.tests.map((t) => t.key)).toEqual(expect.arrayContaining([
      'uc1_delegated_balance',
      'uc1_gateway_accounts',
      'uc5_insufficient_scope',
      'uc12_token_replay',
      'uc13_rogue_actor',
      'uc16_impersonation_no_act',
    ]));
  });
});

describe('POST /api/admin/ping-ai-test-lab/run', () => {
  it('rejects a missing test key', async () => {
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_test_key');
  });

  it('rejects an unknown test key (allow-list)', async () => {
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'rm -rf /' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_test');
  });

  it('rejects removed CIAM eval keys', async () => {
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'eval:CIAM-GS-005' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_test');
  });

  it('scores conn_pingcli as pass when the resolved binary returns a version', async () => {
    jest.resetModules();
    const prevBin = process.env.PINGCLI_BIN;
    process.env.PINGCLI_BIN = '/usr/local/bin/pingcli';
    const execFile = jest.fn((_bin, _args, _opts, cb) => {
      cb(null, 'pingcli version 1.2.0 (commit: abc)\n', '');
    });
    jest.doMock('node:child_process', () => ({ execFile }));
    try {
      const freshApp = express();
      freshApp.use(express.json());
      freshApp.use((req, _res, next) => {
        req.session = { oauthTokens: { accessToken: 'user-at' }, user: { id: 'u1' }, id: 's1' };
        next();
      });
      freshApp.use('/api/admin/ping-ai-test-lab', require('../routes/pingAiTestLab'));
      const res = await request(freshApp)
        .post('/api/admin/ping-ai-test-lab/run')
        .send({ testKey: 'conn_pingcli' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('pass');
      expect(execFile.mock.calls[0][0]).toBe('/usr/local/bin/pingcli');
      expect(res.body.detail.bin).toBe('/usr/local/bin/pingcli');
    } finally {
      if (prevBin === undefined) delete process.env.PINGCLI_BIN;
      else process.env.PINGCLI_BIN = prevBin;
    }
  });

  it('runs UC1 delegated balance through executeBffTool when session tokens exist', async () => {
    jest.resetModules();
    jest.doMock('../services/bffMcpToolExecutor', () => ({
      executeBffTool: jest.fn(async ({ name, tokenEvents }) => {
        tokenEvents.push({ id: 'two-ex-final-token', label: 'MCP Token', status: 'exchanged' });
        return JSON.stringify({ account_id: 'a1', balance: 100, currency: 'USD' });
      }),
    }));
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: 'user-at' }, user: { id: 'u1' }, id: 's1' };
      next();
    });
    freshApp.use('/api/admin/ping-ai-test-lab', require('../routes/pingAiTestLab'));
    const res = await request(freshApp)
      .post('/api/admin/ping-ai-test-lab/run')
      .send({ testKey: 'uc1_delegated_balance' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pass');
    expect(res.body.detail.useCaseId).toBe('delegated-access-with-proof');
    expect(res.body.detail.tool).toBe('get_account_balance');
  });

  it('scores UC5 insufficient-scope as pass when the attack sim is denied', async () => {
    jest.resetModules();
    jest.doMock('../services/attackSimulatorService', () => ({
      runAttackSim: jest.fn(async () => ({
        sim: 'insufficient-scope',
        useCaseId: 'insufficient-scope',
        status: 403,
        errorCode: 'insufficient_scope',
        reason: 'scope denied',
        tokenChainEvents: [{ id: 'sim-gateway-deny', label: 'DENY', status: 'error' }],
      })),
    }));
    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use((req, _res, next) => {
      req.session = { oauthTokens: { accessToken: 'user-at' }, user: { id: 'u1' }, id: 's1' };
      next();
    });
    freshApp.use('/api/admin/ping-ai-test-lab', require('../routes/pingAiTestLab'));
    const res = await request(freshApp)
      .post('/api/admin/ping-ai-test-lab/run')
      .send({ testKey: 'uc5_insufficient_scope' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pass');
    expect(res.body.detail.expectedOutcome).toBe('DENY');
  });
});
