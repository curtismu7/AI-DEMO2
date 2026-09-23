'use strict';

const { exchangeAsGeneralist } = require('../services/a2aDelegationService');

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.`;
}

function dependencies(provider, issuer) {
  const oauthService = {
    getAiAgentClientCredentialsToken: jest.fn().mockResolvedValue(jwt({ sub: 'agent1' })),
    performTokenExchangeAs: jest.fn().mockResolvedValue(jwt({ sub: 'user-1', act: { sub: 'agent1' } })),
  };
  const configStore = {
    getOAuthProvider: () => provider,
    getEffective: (key) => ({
      pingone_ai_agent_client_id: 'agent1',
      pingone_ai_agent_client_secret: 'agent1-secret',
      pingone_investment_agent_client_id: 'agent2',
      pingone_investment_agent_client_secret: 'agent2-secret',
      oauth_issuer: provider === 'pingone' ? issuer : '',
      pf_issuer: 'https://local.ping-devops.com:9031',
    })[key] || '',
  };
  return {
    oauthService,
    configStore,
    getIssuer: () => issuer,
    getSessionBearerForMcp: () => jwt({ sub: 'user-1', iss: issuer }),
    scopeTopology: {
      resourceUri: (name) => name === 'A2A Investment Intermediate' ? 'a2a-investment' : 'https://api.ping.demo/mcp-gateway',
      a2aDelegatedScope: () => 'investment:read',
      toolScopes: () => [],
    },
  };
}

describe('A2A token provider follows the authenticated session issuer', () => {
  test.each([
    ['pingone', 'https://auth.pingone.com/env-1/as'],
    ['pingfederate', 'https://local.ping-devops.com:9031'],
  ])('%s session can enter the matching provider exchange', async (provider, issuer) => {
    const deps = dependencies(provider, issuer);
    const result = await exchangeAsGeneralist({}, { vertical: 'banking', deps, exchangeAttempts: 1 });

    expect(result.error).toBeUndefined();
    expect(deps.oauthService.getAiAgentClientCredentialsToken).toHaveBeenCalledTimes(1);
    expect(deps.oauthService.performTokenExchangeAs).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['pingfederate', 'https://auth.pingone.com/env-1/as'],
    ['pingone', 'https://local.ping-devops.com:9031'],
  ])('rejects a %s runtime when the session token belongs to the other provider', async (provider, issuer) => {
    const deps = dependencies(provider, issuer);
    const result = await exchangeAsGeneralist({}, { vertical: 'banking', deps });

    expect(result.error).toMatch(/provider does not match/i);
    expect(deps.oauthService.getAiAgentClientCredentialsToken).not.toHaveBeenCalled();
    expect(deps.oauthService.performTokenExchangeAs).not.toHaveBeenCalled();
  });

  test('rejects an unrecognized issuer before minting an actor token', async () => {
    const deps = dependencies('pingone', 'https://idp.example.test');
    const result = await exchangeAsGeneralist({}, { vertical: 'banking', deps });

    expect(result.error).toMatch(/issuer is not recognized/i);
    expect(deps.oauthService.getAiAgentClientCredentialsToken).not.toHaveBeenCalled();
  });

  test('records the exact failing stage when Agent 1 credentials are rejected', async () => {
    const deps = dependencies('pingone', 'https://auth.pingone.com/env-1/as');
    const error = Object.assign(new Error('invalid_client'), { code: 'invalid_client' });
    deps.oauthService.getAiAgentClientCredentialsToken.mockRejectedValue(error);
    const result = await exchangeAsGeneralist({}, { vertical: 'banking', deps, exchangeAttempts: 1 });

    expect(result.tokenEvents.at(-1)).toMatchObject({
      id: 'a2a-exchange-failed',
      status: 'failed',
      stage: 'agent1_actor',
      code: 'a2a_agent1_actor_failed',
      upstreamCode: 'invalid_client',
    });
  });
});
