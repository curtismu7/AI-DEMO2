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
    expect(res.body.suites.map((s) => s.key)).toEqual(['skills', 'mcp', 'agent', 'evals']);
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
