'use strict';

const mockGetAiAgentClientCredentialsToken = jest.fn();
const mockPerformTokenExchangeAs = jest.fn();
const mockGetEffective = jest.fn();

jest.mock('../../services/oauthService', () => ({
  getAiAgentClientCredentialsToken: (...args) => mockGetAiAgentClientCredentialsToken(...args),
  performTokenExchangeAs: (...args) => mockPerformTokenExchangeAs(...args),
}));
jest.mock('../../services/configStore', () => ({ getEffective: (...args) => mockGetEffective(...args) }));

function jwt(claims, header = { alg: 'RS256', typ: 'JWT' }) {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc(header)}.${enc(claims)}.signature`;
}

const values = {
  pf_standard_agent_exchange_client_id: 'pf-agent-hop-client',
  pf_standard_agent_exchange_client_secret: 'pf-agent-hop-secret',
  pf_standard_token_exchange_client_id: 'pf-mcp-hop-client',
  pf_standard_token_exchange_client_secret: 'pf-mcp-hop-secret',
  pf_ai_agent_actor_client_id: 'pf-agent-actor',
  pf_ai_agent_actor_client_secret: 'pf-agent-actor-secret',
  pf_standard_token_exchange_actor_scope: 'agent:invoke',
  pf_mcp_service_actor_client_id: 'pf-mcp-actor',
  pf_mcp_service_actor_client_secret: 'pf-mcp-actor-secret',
  pf_standard_mcp_actor_scope: 'mcp:invoke',
  pf_standard_intermediate_audience: 'https://pf.example.test/agent-intermediate',
};

describe('PF standard token-exchange provider adapter', () => {
  let service;
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetEffective.mockImplementation((key) => values[key] || '');
    service = require('../../services/pfStandardTokenExchangeService');
  });

  test('resolves independent PF clients, actor roles, and intermediate audience', () => {
    expect(service.resolveConfig()).toEqual(expect.objectContaining({
      agentExchangeClientId: 'pf-agent-hop-client',
      mcpExchangeClientId: 'pf-mcp-hop-client',
      agentActorClientId: 'pf-agent-actor',
      mcpActorClientId: 'pf-mcp-actor',
      intermediateAudience: values.pf_standard_intermediate_audience,
    }));
  });

  test('fails closed when the MCP-service actor client is missing', () => {
    mockGetEffective.mockImplementation((key) => key === 'pf_mcp_service_actor_client_secret' ? '' : values[key] || '');
    expect(() => service.resolveConfig()).toThrow(/PF_MCP_SERVICE_ACTOR_CLIENT_SECRET/);
  });

  test('gets and validates actor tokens against their configured role', async () => {
    mockGetAiAgentClientCredentialsToken
      .mockResolvedValueOnce(jwt({ sub: 'unexpected-agent', client_id: 'unexpected-agent' }))
      .mockResolvedValueOnce(jwt({ sub: 'pf-mcp-actor', client_id: 'pf-mcp-actor', scope: 'mcp:invoke' }));
    const config = service.resolveConfig();
    await expect(service.getActorToken(config, 'agent')).rejects.toThrow(/AI-agent actor identity mismatch/i);
    await expect(service.getActorToken(config, 'mcp')).resolves.toBeTruthy();
  });

  test('requests access tokens from each PF policy without sending audience overrides', async () => {
    mockPerformTokenExchangeAs.mockResolvedValue('opaque-token');
    const config = service.resolveConfig();
    await service.performExchange(config, 'agent', 'subject', 'agent-actor', config.intermediateAudience, ['agent:invoke']);
    await service.performExchange(config, 'mcp', 'intermediate', 'mcp-actor', 'https://api.ping.demo:3036/mcp', ['airlines:read']);
    expect(mockPerformTokenExchangeAs).toHaveBeenNthCalledWith(
      1, 'subject', 'agent-actor', 'pf-agent-hop-client', 'pf-agent-hop-secret',
      config.intermediateAudience, ['agent:invoke'], 'basic',
      expect.objectContaining({ requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token', omitAudience: true })
    );
    expect(mockPerformTokenExchangeAs).toHaveBeenNthCalledWith(
      2, 'intermediate', 'mcp-actor', 'pf-mcp-hop-client', 'pf-mcp-hop-secret',
      'https://api.ping.demo:3036/mcp', ['airlines:read'], 'basic',
      expect.objectContaining({ requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token', omitAudience: true })
    );
  });

  test('validates subject, audience, scope, and nested actor semantics on each result', () => {
    const config = service.resolveConfig();
    const agentActor = jwt({ sub: 'pf-agent-actor', client_id: 'pf-agent-actor', scope: 'agent:invoke' });
    const mcpActor = jwt({ sub: 'pf-mcp-actor', client_id: 'pf-mcp-actor', scope: 'mcp:invoke' });
    const intermediate = jwt({ sub: 'user-123', aud: config.intermediateAudience, scope: 'agent:invoke airlines:read' });
    expect(service.validateIntermediateToken(intermediate, {
      userSub: 'user-123', audience: config.intermediateAudience, scopes: ['agent:invoke', 'airlines:read'],
    }).claims.sub).toBe('user-123');
    const final = jwt({
      sub: 'user-123', aud: 'https://api.ping.demo:3036/mcp', scope: 'airlines:read mcp:invoke',
      act: { sub: 'pf-mcp-actor', act: { sub: 'pf-agent-actor' } },
    });
    expect(service.validateFinalToken(final, {
      userSub: 'user-123', audience: 'https://api.ping.demo:3036/mcp',
      scopes: ['airlines:read', 'mcp:invoke'], agentActorToken: agentActor, mcpActorToken: mcpActor,
    }).claims.act).toEqual({ sub: 'pf-mcp-actor', act: { sub: 'pf-agent-actor' } });
    const flatAct = jwt({
      sub: 'user-123', aud: 'https://api.ping.demo:3036/mcp', scope: 'airlines:read mcp:invoke',
      act: { sub: 'pf-agent-actor' },
    });
    expect(service.validateFinalToken(flatAct, {
      userSub: 'user-123', audience: 'https://api.ping.demo:3036/mcp',
      scopes: ['airlines:read', 'mcp:invoke'], agentActorToken: agentActor, mcpActorToken: mcpActor,
    }).claims.act).toEqual({ sub: 'pf-agent-actor' });
    expect(() => service.validateFinalToken(final, {
      userSub: 'user-123', audience: 'https://wrong.example/mcp',
      scopes: ['airlines:read', 'mcp:invoke'], agentActorToken: agentActor, mcpActorToken: mcpActor,
    })).toThrow(/final audience mismatch/i);
  });
});
