// demo_api_server/src/__tests__/agentBuilderService.test.js
'use strict';

jest.mock('axios');
jest.mock('../../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('mock-mgmt-token'),
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    PINGONE_ENVIRONMENT_ID: 'env-123',
    PINGONE_REGION: 'com',
    PUBLIC_APP_URL: 'https://demo-api-server:3001',
  })[key]),
}));

const axios = require('axios');
// Top-level require — setup.js runs jest.resetModules() after every test, so
// an in-test require would return a DIFFERENT mock instance than the one the
// service module captured at load. Share the load-time instance.
const configStore = require('../../services/configStore');
const svc = require('../../services/agentBuilderService');

const USER = { id: 'u1', username: 'demoUser', email: 'demoUser@demo.test', oauthId: 'sub-abc' };
const BASE = 'https://api.pingone.com/v1/environments/env-123';

// Helper: axios.get/post/delete are mocked per-URL via implementation maps.
function mockGet(map) {
  axios.get.mockImplementation((url) => {
    for (const [frag, val] of Object.entries(map)) {
      if (url.includes(frag)) return Promise.resolve({ data: val });
    }
    return Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: {} } }));
  });
}

beforeEach(() => jest.clearAllMocks());

describe('agent naming + lookup', () => {
  test('agentName is deterministic per user', () => {
    expect(svc.agentName(USER)).toBe('AI Agent - demoUser');
  });

  test('getAgentForUser returns null when no app matches', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{ name: 'Other', description: '' }] } } });
    expect(await svc.getAgentForUser(USER)).toBeNull();
  });

  test('getAgentForUser returns summary when marked app exists', async () => {
    mockGet({
      '/applications': { _embedded: { applications: [{
        id: 'app-1', name: 'AI Agent - demoUser', type: 'WEB_APP',
        description: 'Created by Agent Builder for sub-abc',
        grantTypes: ['AUTHORIZATION_CODE'], tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
        createdAt: '2026-06-12T00:00:00Z', enabled: true,
      }] } },
    });
    const agent = await svc.getAgentForUser(USER);
    expect(agent).toMatchObject({ id: 'app-1', type: 'WEB_APP', fallback: true });
  });
});

describe('createAgentForUser', () => {
  test('creates a first-class AI_AGENT via /applications', async () => {
    mockGet({ '/applications': { _embedded: { applications: [] } } });
    axios.post.mockResolvedValue({ data: {
      id: 'agent-new', name: 'AI Agent - demoUser', type: 'AI_AGENT', enabled: true,
    } });
    const result = await svc.createAgentForUser(USER);
    expect(result.created).toBe(true);
    expect(result.agent.type).toBe('AI_AGENT');
    expect(result.agent.fallback).toBe(false);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/applications');
    expect(body).toMatchObject({
      name: 'AI Agent - demoUser',
      type: 'AI_AGENT',
      enabled: true,
      protocol: 'OPENID_CONNECT',
      tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
      description: 'Created by Agent Builder for sub-abc',
    });
  });

  test('falls back to WEB_APP when the environment rejects the AI_AGENT type', async () => {
    mockGet({ '/applications': { _embedded: { applications: [] } } });
    axios.post.mockImplementation((url, body) => {
      if (body.type === 'AI_AGENT') {
        return Promise.reject(Object.assign(new Error('400'), {
          response: { status: 400, data: { code: 'INVALID_DATA', details: [
            { code: 'INVALID_VALUE', target: 'type', message: 'type must be one of ...' },
          ] } },
        }));
      }
      return Promise.resolve({ data: { id: 'app-new', ...body } });
    });
    const result = await svc.createAgentForUser(USER);
    expect(result.created).toBe(true);
    expect(result.agent.fallback).toBe(true);
    const webAppCall = axios.post.mock.calls.find(([, body]) => body.type === 'WEB_APP');
    expect(webAppCall[1]).toMatchObject({
      name: 'AI Agent - demoUser',
      type: 'WEB_APP',
      protocol: 'OPENID_CONNECT',
      grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'],
      responseTypes: ['CODE'],
      tokenEndpointAuthMethod: 'CLIENT_SECRET_POST',
      description: 'Created by Agent Builder for sub-abc',
    });
  });

  test('is idempotent — returns existing agent with created:false and does not POST', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{
      id: 'app-1', name: 'AI Agent - demoUser', type: 'WEB_APP',
      description: 'Created by Agent Builder for sub-abc',
    }] } } });
    const result = await svc.createAgentForUser(USER);
    expect(result.created).toBe(false);
    expect(result.agent.id).toBe('app-1');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('deleteAgentForUser', () => {
  test('refuses to delete an app without the builder marker', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{
      id: 'app-x', name: 'AI Agent - demoUser', description: 'Provisioned by bootstrap',
    }] } } });
    await expect(svc.deleteAgentForUser(USER)).rejects.toMatchObject({ code: 'forbidden' });
    expect(axios.delete).not.toHaveBeenCalled();
  });

  test('deletes a marked app', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{
      id: 'app-1', name: 'AI Agent - demoUser',
      description: 'Created by Agent Builder for sub-abc',
    }] } } });
    axios.delete.mockResolvedValue({ data: {} });
    await svc.deleteAgentForUser(USER);
    expect(axios.delete).toHaveBeenCalledWith(
      `${BASE}/applications/app-1`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer mock-mgmt-token' }) })
    );
  });

  test('throws not_found when user has no agent', async () => {
    mockGet({ '/applications': { _embedded: { applications: [] } } });
    await expect(svc.deleteAgentForUser(USER)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('error sanitization', () => {
  test('axios errors escape without config (worker token) but keep response data', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('boom'), {
      isAxiosError: true,
      config: { headers: { Authorization: 'Bearer SECRET' } },
      response: { status: 500, data: { code: 'UNEXPECTED' } },
    }));
    // A 500 from the applications list propagates (sanitized).
    await expect(svc.getAgentForUser(USER)).rejects.toMatchObject({
      message: 'boom',
      response: { status: 500, data: { code: 'UNEXPECTED' } },
    });
    await expect(svc.getAgentForUser(USER)).rejects.not.toHaveProperty('config');
  });
});

describe('resources', () => {
  const RESOURCES = { _embedded: { resources: [
    { id: 'r-openid', name: 'openid', type: 'OPENID_CONNECT' },
    { id: 'r-demo', name: 'Banking API', type: 'CUSTOM', description: 'Demo resource', audience: 'api.ping.demo' },
    { id: 'r-mine', name: 'demoUser - Weather', type: 'CUSTOM', description: 'Created by Agent Builder for sub-abc', audience: 'weather' },
    { id: 'r-theirs', name: 'bob - Stocks', type: 'CUSTOM', description: 'Created by Agent Builder for sub-bob', audience: 'stocks' },
  ] } };
  const SCOPES = (names) => ({ _embedded: { scopes: names.map((n, i) => ({ id: `s-${n}-${i}`, name: n })) } });

  test('listResourcesForUser: CUSTOM only, marks ownership, excludes other users', async () => {
    mockGet({
      '/resources?limit=100': RESOURCES,
      '/resources/r-demo/scopes': SCOPES(['read', 'write', 'admin']),
      '/resources/r-mine/scopes': SCOPES(['read', 'forecast']),
    });
    const out = await svc.listResourcesForUser(USER);
    expect(out.map((r) => r.id).sort()).toEqual(['r-demo', 'r-mine']);
    expect(out.find((r) => r.id === 'r-demo').ownedByUser).toBe(false);
    expect(out.find((r) => r.id === 'r-mine').ownedByUser).toBe(true);
    expect(out.find((r) => r.id === 'r-mine').scopes).toEqual(['read', 'forecast']);
  });

  test('createUserResource creates resource + scopes with marker', async () => {
    mockGet({ '/resources?limit=100': { _embedded: { resources: [] } } });
    axios.post.mockImplementation((url) => {
      if (url.endsWith('/resources')) return Promise.resolve({ data: { id: 'r-new', name: 'demoUser - Weather' } });
      if (url.includes('/resources/r-new/scopes')) return Promise.resolve({ data: { id: 's-new' } });
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });
    const res = await svc.createUserResource(USER, { name: 'Weather', audience: 'weather-api', scopes: ['read', 'forecast'] });
    expect(res.resource.id).toBe('r-new');
    const resourceCall = axios.post.mock.calls.find(([url]) => url.endsWith('/resources'));
    expect(resourceCall[1]).toMatchObject({
      name: 'demoUser - Weather', type: 'CUSTOM', audience: 'weather-api',
      description: 'Created by Agent Builder for sub-abc',
    });
    const scopeCalls = axios.post.mock.calls.filter(([url]) => url.includes('/scopes'));
    expect(scopeCalls).toHaveLength(2);
  });

  test('createUserResource rejects bad names', async () => {
    await expect(svc.createUserResource(USER, { name: 'a'.repeat(50), scopes: ['read'] }))
      .rejects.toMatchObject({ code: 'invalid' });
  });

  test('deleteUserResource refuses unowned resource', async () => {
    mockGet({ '/resources/r-theirs': { id: 'r-theirs', description: 'Created by Agent Builder for sub-bob' } });
    await expect(svc.deleteUserResource(USER, 'r-theirs')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('grants', () => {
  test('getAgentGrants resolves scope ids to names per resource', async () => {
    mockGet({
      '/applications/app-1/grants': { _embedded: { grants: [
        { id: 'g1', resource: { id: 'r-demo' }, scopes: [{ id: 's-read-0' }] },
      ] } },
      '/resources/r-demo/scopes': { _embedded: { scopes: [{ id: 's-read-0', name: 'read' }, { id: 's-write-1', name: 'write' }] } },
    });
    const grants = await svc.getAgentGrants('app-1');
    expect(grants).toEqual({ 'r-demo': ['read'] });
  });

  test('setAgentGrants creates, replaces, and removes grants to match desired state', async () => {
    mockGet({
      '/applications/app-1/grants': { _embedded: { grants: [
        { id: 'g1', resource: { id: 'r-old' }, scopes: [{ id: 's-x' }] },
        { id: 'g2', resource: { id: 'r-keep' }, scopes: [{ id: 's-read-0' }] },
      ] } },
      '/resources/r-keep/scopes': { _embedded: { scopes: [{ id: 's-read-0', name: 'read' }, { id: 's-write-1', name: 'write' }] } },
      '/resources/r-new/scopes': { _embedded: { scopes: [{ id: 's-read-9', name: 'read' }] } },
    });
    axios.put.mockResolvedValue({ data: {} });
    axios.post.mockResolvedValue({ data: {} });
    axios.delete.mockResolvedValue({ data: {} });

    await svc.setAgentGrants('app-1', [
      { resourceId: 'r-keep', scopes: ['read', 'write'] },  // existing → PUT merged set
      { resourceId: 'r-new', scopes: ['read'] },             // new → POST
    ]);

    expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/applications/app-1/grants/g1'), expect.anything());
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining('/applications/app-1/grants/g2'),
      { resource: { id: 'r-keep' }, scopes: [{ id: 's-read-0' }, { id: 's-write-1' }] },
      expect.anything()
    );
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/applications/app-1/grants'),
      { resource: { id: 'r-new' }, scopes: [{ id: 's-read-9' }] },
      expect.anything()
    );
  });

  test('setAgentGrants maps duplicate-scope-name rejection to a friendly error', async () => {
    mockGet({
      '/applications/app-1/grants': { _embedded: { grants: [] } },
      '/resources/r-a/scopes': { _embedded: { scopes: [{ id: 's1', name: 'read' }] } },
    });
    axios.post.mockRejectedValue(Object.assign(new Error('400'), {
      response: { status: 400, data: { code: 'INVALID_DATA', details: [{ message: 'Multiple scopes with the same name cannot be added to the same grant.' }] } },
    }));
    await expect(svc.setAgentGrants('app-1', [{ resourceId: 'r-a', scopes: ['read'] }]))
      .rejects.toMatchObject({ code: 'duplicate_scope_name' });
  });
});

describe('environment agents (picker)', () => {
  const APPS = { _embedded: { applications: [
    { id: 'a-ai', name: 'Ping Identity', type: 'AI_AGENT', enabled: true, tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' },
    { id: 'a-demo', name: 'Demo Agent', type: 'WORKER', enabled: true, grantTypes: ['CLIENT_CREDENTIALS'] },
    { id: 'a-web', name: 'Demo Admin App', type: 'WEB_APP', enabled: true },
    { id: 'a-mine', name: 'AI Agent - demoUser', type: 'AI_AGENT', description: 'Created by Agent Builder for sub-abc' },
  ] } };

  test('listEnvironmentAgents returns AI_AGENT apps + known demo agent clients only', async () => {
    // NOTE: mockImplementation persists past clearAllMocks — keep every key
    // the rest of the suite needs.
    configStore.getEffective.mockImplementation((key) => ({
      PINGONE_ENVIRONMENT_ID: 'env-123',
      PINGONE_REGION: 'com',
      PUBLIC_APP_URL: 'https://demo-api-server:3001',
      AGENT_CLIENT_ID: 'a-demo',
    })[key]);
    mockGet({ '/applications': APPS });
    const agents = await svc.listEnvironmentAgents();
    expect(agents.map((a) => a.id).sort()).toEqual(['a-ai', 'a-demo', 'a-mine']);
    expect(agents.find((a) => a.id === 'a-mine').builderCreated).toBe(true);
    expect(agents.find((a) => a.id === 'a-ai').builderCreated).toBe(false);
  });

  test('getAgentSetup returns config + resolved grants', async () => {
    mockGet({
      '/applications/a-ai/grants': { _embedded: { grants: [
        { id: 'g1', resource: { id: 'r-demo' }, scopes: [{ id: 's-read-0' }] },
      ] } },
      '/applications/a-ai': { id: 'a-ai', name: 'Ping Identity', type: 'AI_AGENT',
        grantTypes: ['CLIENT_CREDENTIALS'], tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' },
      '/resources/r-demo/scopes': { _embedded: { scopes: [{ id: 's-read-0', name: 'read' }] } },
    });
    const setup = await svc.getAgentSetup('a-ai');
    expect(setup).toMatchObject({
      id: 'a-ai',
      grantTypes: ['CLIENT_CREDENTIALS'],
      tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC',
      grants: { 'r-demo': ['read'] },
    });
  });

  test('createAgentForUser applies copied config overrides to the AI_AGENT payload', async () => {
    mockGet({ '/applications': { _embedded: { applications: [] } } });
    axios.post.mockResolvedValue({ data: { id: 'agent-new', type: 'AI_AGENT' } });
    await svc.createAgentForUser(USER, {
      grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'],
      tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC',
    });
    expect(axios.post.mock.calls[0][1]).toMatchObject({
      type: 'AI_AGENT',
      grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'],
      tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC',
    });
  });
});

describe('upgradeAgentForUser', () => {
  test('rejects when the agent is already AI_AGENT', async () => {
    mockGet({ '/applications': { _embedded: { applications: [{
      id: 'app-1', name: 'AI Agent - demoUser', type: 'AI_AGENT',
      description: 'Created by Agent Builder for sub-abc',
    }] } } });
    await expect(svc.upgradeAgentForUser(USER)).rejects.toMatchObject({ code: 'invalid' });
  });

  test('deletes the fallback app, recreates as AI_AGENT, and re-applies grants', async () => {
    let deleted = false;
    axios.get.mockImplementation((url) => {
      if (url.includes('/applications?limit=100')) {
        return Promise.resolve({ data: { _embedded: { applications: deleted ? [] : [{
          id: 'app-old', name: 'AI Agent - demoUser', type: 'WEB_APP',
          description: 'Created by Agent Builder for sub-abc',
        }] } } });
      }
      if (url.includes('/applications/app-old/grants')) {
        return Promise.resolve({ data: { _embedded: { grants: [
          { id: 'g1', resource: { id: 'r-demo' }, scopes: [{ id: 's-read-0' }] },
        ] } } });
      }
      if (url.includes('/applications/agent-new/grants')) {
        return Promise.resolve({ data: { _embedded: { grants: [] } } });
      }
      if (url.includes('/resources/r-demo/scopes')) {
        return Promise.resolve({ data: { _embedded: { scopes: [{ id: 's-read-0', name: 'read' }] } } });
      }
      return Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: {} } }));
    });
    axios.delete.mockImplementation(() => { deleted = true; return Promise.resolve({ data: {} }); });
    axios.post.mockImplementation((url, body) => {
      if (body && body.type === 'AI_AGENT') return Promise.resolve({ data: { id: 'agent-new', type: 'AI_AGENT' } });
      if (url.includes('/grants')) return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`unexpected POST ${url}`));
    });

    const result = await svc.upgradeAgentForUser(USER);
    expect(result.agent.type).toBe('AI_AGENT');
    expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/applications/app-old'), expect.anything());
    const grantPost = axios.post.mock.calls.find(([url]) => url.includes('/applications/agent-new/grants'));
    expect(grantPost[1]).toEqual({ resource: { id: 'r-demo' }, scopes: [{ id: 's-read-0' }] });
  });
});
