'use strict';

/**
 * LLM token custody — the user token lives only in deterministic code, and
 * nothing the LLM produces can pick a credential, a destination, or a route
 * around the MCP gateway and PingOne Authorize.
 * Plan: docs/superpowers/plans/2026-09-11-user-token-custody.md.
 *
 * The pipeline's A2A authorize-skip and the A2A local-serve cases sit with
 * their existing fixtures: src/__tests__/mcpToolPipeline.authzBypass.test.js
 * and src/__tests__/a2aExecution.test.js.
 */

const express = require('express');
const supertest = require('supertest');

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl'; // gitleaks:allow — fake test JWT, not a credential

describe('runReasonLoop — what the model can call and what it sees', () => {
  let axios;
  let runReasonLoop;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('axios');
    axios = require('axios');
    ({ runReasonLoop } = require('../services/agentReasoningClient'));
  });

  const run = (executeTool) => runReasonLoop({
    messages: [{ role: 'user', content: 'x' }],
    tools: [{ name: 'get_my_accounts', description: '', inputSchema: {} }],
    provider: 'helix',
    executeTool,
    maxIterations: 5,
  });

  test('a tool the model was not offered is never executed', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { type: 'tool_calls', calls: [{ id: '1', name: 'delete_everything', args: {} }], messages: [] } })
      .mockResolvedValueOnce({ data: { type: 'final', answer: 'done', messages: [] } });
    const executeTool = jest.fn(async () => 'r');

    await run(executeTool);

    expect(executeTool).not.toHaveBeenCalled();
    const sent = axios.post.mock.calls[1][1].messages;
    expect(sent[sent.length - 1]).toMatchObject({ role: 'tool', tool_call_id: '1' });
    expect(sent[sent.length - 1].content).toContain('tool_not_offered');
  });

  test('a JWT inside a tool result reaches the model redacted', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { type: 'tool_calls', calls: [{ id: '1', name: 'get_my_accounts', args: {} }], messages: [] } })
      .mockResolvedValueOnce({ data: { type: 'final', answer: 'done', messages: [] } });

    const out = await run(async () => JSON.stringify({ error: 'upstream', message: `Bearer ${JWT} rejected` }));

    const sent = axios.post.mock.calls[1][1].messages;
    expect(sent[sent.length - 1].content).not.toContain('eyJ');
    expect(sent[sent.length - 1].content).toContain('[REDACTED_JWT]');
    expect(out.toolResults[0].result).not.toContain('eyJ');
  });
});

describe('/internal/agent-tool — only tools offered to the external agent', () => {
  const SESSION = { user: { id: 'u1' }, oauthTokens: { accessToken: 'tok' }, agentRunToolNames: ['get_my_accounts'] };
  let executeBffTool;

  function post(session, body) {
    jest.resetModules();
    executeBffTool = jest.fn(async () => JSON.stringify({ ok: true, note: `Bearer ${JWT}` }));
    jest.doMock('../services/bffMcpToolExecutor', () => ({ executeBffTool }));
    jest.doMock('../services/a2aDelegationService', () => ({ isA2aEnabled: () => false }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.sessionStore = { get: (_id, cb) => cb(null, session) };
      next();
    });
    app.use('/internal', require('../routes/agentTool'));
    return supertest(app)
      .post('/internal/agent-tool')
      .set('x-internal-gateway-secret', 'dev-shared-secret-change-me')
      .send(body);
  }

  test('a tool not offered in this session is refused', async () => {
    const res = await post(SESSION, { tool: 'create_transfer', args: {}, sessionId: 's1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tool_not_offered');
    expect(executeBffTool).not.toHaveBeenCalled();
  });

  test('a session with no offered-tool list is refused', async () => {
    const { agentRunToolNames: _omit, ...bare } = SESSION;
    const res = await post(bare, { tool: 'get_my_accounts', args: {}, sessionId: 's1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tool_not_offered');
  });

  test('an offered tool runs, and a JWT in its result is redacted', async () => {
    const res = await post(SESSION, { tool: 'get_my_accounts', args: {}, sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('eyJ');
    expect(res.body.result.note).toContain('[REDACTED_JWT]');
  });
});

describe('agentRun — recording the tools offered to an external agent run', () => {
  let recordOfferedTools;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../services/configStore', () => ({ getEffective: jest.fn() }));
    ({ recordOfferedTools } = require('../routes/agentRun').__test);
  });

  test('adds this run\'s tools to the session list and never drops an earlier run\'s', async () => {
    const req = { session: { agentRunToolNames: ['get_balance'], save: (cb) => cb() } };
    await recordOfferedTools(req, [{ name: 'get_my_accounts' }, { name: 'get_balance' }]);
    expect(req.session.agentRunToolNames.sort()).toEqual(['get_balance', 'get_my_accounts']);
  });

  test('rejects when the session store cannot save, so the run is not started', async () => {
    const req = { session: { save: (cb) => cb(new Error('store down')) } };
    await expect(recordOfferedTools(req, [{ name: 'get_my_accounts' }])).rejects.toThrow('store down');
  });
});

describe('executeBffToolWithToken — the gateway decision survives an error', () => {
  test('passes gatewayDecision through its error result', async () => {
    jest.resetModules();
    // doMock registrations survive resetModules; the agent-tool block above
    // replaced the executor with a stub.
    jest.dontMock('../services/bffMcpToolExecutor');
    jest.doMock('../services/mcpToolPipeline', () => ({
      runMcpToolPipeline: jest.fn(async () => ({
        kind: 'error',
        body: { error: 'mcp_error', message: 'upstream 502', gatewayDecision: 'PERMIT' },
      })),
    }));
    const executor = require('../services/bffMcpToolExecutor');
    executor.setPipelineDeps({ emit: () => {} });

    const out = JSON.parse(await executor.executeBffToolWithToken({
      name: 'sensitive_patient_records',
      args: {},
      req: { session: { user: { id: 'u1' } } },
      suppliedToken: 'NESTED.ACT.TOKEN',
    }));

    expect(out).toMatchObject({ error: 'mcp_error', gatewayDecision: 'PERMIT' });
  });
});

describe('call_pingone_tool — allowlisted hosted PingOne tools only', () => {
  function load() {
    jest.resetModules();
    const callTool = jest.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ users: [] }) }] }));
    jest.doMock('../services/mcpPingOneHttpAdapter', () => ({ callTool, listTools: jest.fn().mockResolvedValue([]) }));
    const { execute } = require('../config/verticals/pingone-admin/tools');
    return { execute, callTool };
  }

  test('a tool outside the allowlist is refused before PingOne is called', async () => {
    const { execute, callTool } = load();
    const { result } = await execute('call_pingone_tool', { name: 'deleteUser', arguments: { userId: 'x' } }, {});
    expect(callTool).not.toHaveBeenCalled();
    expect(result.error).toMatch(/not allowed/i);
  });

  test('createUser stays allowed (documented exception)', async () => {
    const { execute, callTool } = load();
    await execute('call_pingone_tool', { name: 'createUser', arguments: { username: 'x' } }, {});
    expect(callTool).toHaveBeenCalled();
    expect(callTool.mock.calls[0][0]).toBe('createUser');
  });
});

describe('delegation records never carry the stored access token', () => {
  test('listAllDelegations omits access_token', async () => {
    jest.resetModules();
    const rows = new Map([['d1', {
      id: 'd1', delegator_user_id: 'a', delegate_user_id: 'b', status: 'active',
      scopes: [], granted_at: '2026-09-11T00:00:00Z', access_token: JWT,
    }]]);
    jest.doMock('../services/lmdb/openEnv', () => ({
      getDb: () => ({ getRange: () => [...rows.values()].map((value) => ({ value })) }),
    }));
    jest.doMock('../services/pingOneUserLookupService', () => ({ fetchPingOneUserByUsername: jest.fn() }));
    jest.doMock('../services/pingOneClientService', () => ({ getManagementToken: jest.fn() }));
    jest.doMock('../services/pingoneBootstrapService', () => ({ fetchFirstPopulationId: jest.fn() }));
    jest.doMock('../services/pingOneUserService', () => ({ initialize: jest.fn(), setDelegatedToAttribute: jest.fn() }));
    const { listAllDelegations } = require('../services/delegationService');

    const [rec] = await listAllDelegations();

    expect(rec.id).toBe('d1');
    expect(rec).not.toHaveProperty('access_token');
  });
});
