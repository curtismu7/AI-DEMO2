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

// The global test setup calls jest.resetModules() after every test, so the
// route's lazy require() resolves to a FRESH adapter mock per test. Re-require
// inside each test to configure the instance the route will actually see.
const adapter = () => require('../services/mcpPingOneHttpAdapter');

const app = express();
app.use(express.json());
app.use('/api/admin/ping-ai-test-lab', pingAiTestLabRoutes);

const POPULATION_TOOLS = [
  { name: 'listPopulations', inputSchema: { properties: { environmentId: {} } } },
  { name: 'listSignOnPolicies', inputSchema: { properties: { environmentId: {} } } },
];

describe('GET /api/admin/ping-ai-test-lab/suites', () => {
  it('returns the four suites with the full CIAM eval catalog', async () => {
    const res = await request(app).get('/api/admin/ping-ai-test-lab/suites');
    expect(res.status).toBe(200);
    expect(res.body.suites.map((s) => s.key)).toEqual(['skills', 'mcp', 'usecases', 'evals']);
    const usecases = res.body.suites.find((s) => s.key === 'usecases');
    expect(usecases.tests.map((t) => t.key)).toEqual(expect.arrayContaining([
      'uc1_delegated_balance',
      'uc1_gateway_accounts',
      'uc5_insufficient_scope',
      'uc12_token_replay',
      'uc13_rogue_actor',
      'uc16_impersonation_no_act',
    ]));
    expect(res.body.evalRowCount).toBe(57);
    const evals = res.body.suites.find((s) => s.key === 'evals');
    expect(evals.tests).toHaveLength(57);
    expect(evals.tests[0]).toMatchObject({
      key: expect.stringMatching(/^eval:CIAM-/),
      checkCount: expect.any(Number),
      runnableCount: expect.any(Number),
    });
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

  it('rejects an unknown eval row id', async () => {
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'eval:CIAM-XX-999' });
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

  it('returns the six Agent Skills for skills_catalog', async () => {
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'skills_catalog' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pass');
    expect(res.body.detail.skills).toHaveLength(6);
    expect(res.body.detail.skills.map((s) => s.name)).toContain('ping-identity-for-ai');
  });

  it('runs an eval row via MCP tools and passes when conditions hold', async () => {
    const { listTools, callTool } = adapter();
    listTools.mockResolvedValue(POPULATION_TOOLS);
    callTool.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          _embedded: {
            populations: [{ id: 'p1' }],
            signOnPolicies: [{ id: 's1' }],
          },
        }),
      }],
    });
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'eval:CIAM-GS-005' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pass');
    const byStatus = res.body.detail.checks.reduce((m, c) => ({ ...m, [c.status]: (m[c.status] || 0) + 1 }), {});
    expect(byStatus.pass).toBe(2); // populations + sign-on policies
    expect(byStatus.not_run).toBe(3); // manual checks never execute
    expect(callTool).toHaveBeenCalledWith('listPopulations', expect.any(Object));
  });

  it('fails an eval row when the MCP body does not meet the condition', async () => {
    const { listTools, callTool } = adapter();
    listTools.mockResolvedValue(POPULATION_TOOLS);
    callTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ _embedded: { populations: [], signOnPolicies: [] } }) }],
    });
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'eval:CIAM-GS-005' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fail');
  });

  it('reports not_run when no read-only MCP tool matches (headless policy: never falls back to direct API)', async () => {
    const { listTools, callTool } = adapter();
    listTools.mockResolvedValue([]);
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'eval:CIAM-GS-005' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_run');
    expect(callTool).not.toHaveBeenCalledWith(expect.stringMatching(/delete|create|update/i), expect.anything());
  });

  it('scores CIAM-GS-002 as not_configured when invited.admin@example.com is absent (demo gap, not a fail)', async () => {
    const { listTools, callTool } = adapter();
    listTools.mockResolvedValue([
      { name: 'listUsers', inputSchema: { properties: { environmentId: {} } } },
    ]);
    callTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ _embedded: { users: [{ email: 'demoUser@example.com' }] } }) }],
    });
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'eval:CIAM-GS-002' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_configured');
    const invited = res.body.detail.checks.find((c) => c.checkId === 'invited-admin-user-exists');
    expect(invited.status).toBe('not_configured');
    expect(invited.reason).toMatch(/invited\.admin@example\.com/);
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

  it('scores CIAM-DP-001 as not_configured when DEV/QA named envs are absent', async () => {
    const { listTools, callTool } = adapter();
    listTools.mockResolvedValue([
      { name: 'listEnvironments', inputSchema: { properties: { limit: {} } } },
    ]);
    callTool.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({ _embedded: { environments: [{ name: 'AI-DEMO', type: 'SANDBOX' }] } }),
      }],
    });
    const res = await request(app).post('/api/admin/ping-ai-test-lab/run').send({ testKey: 'eval:CIAM-DP-001' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_configured');
    expect(res.body.detail.checks.filter((c) => c.status === 'not_configured').length).toBeGreaterThanOrEqual(2);
  });
});

describe('eval data integrity', () => {
  const { rows } = require('../data/ciamEvalChecks.json');

  it('covers all 57 CIAM rows with rubric weights summing to 1.0', () => {
    expect(rows).toHaveLength(57);
    for (const row of rows) {
      const total = row.rubric.reduce((s, r) => s + r.weight, 0);
      expect(Math.abs(total - 1.0)).toBeLessThan(1e-9);
      expect(row.pingone.length).toBeGreaterThan(0);
      expect(row.aic.length).toBeGreaterThan(0);
    }
  });

  it('only ever declares read-only GET api checks', () => {
    for (const row of rows) {
      for (const check of row.pingone) {
        if (check.run && check.run.kind === 'api') {
          expect(check.run.method || 'GET').toBe('GET');
        }
      }
    }
  });
});
