'use strict';

/**
 * A2A delegation with a specialist the identity sidecar manages (ff_agent_identity_sidecar).
 * The specialist's own secret is not required locally; unmanaged behaves exactly as before.
 */

const mockRelay = { manages: jest.fn() };
jest.mock('../../services/sidecarClientRelay', () => mockRelay);

const a2a = require('../../services/a2aDelegationService');

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

const AGENT1 = 'agent1-client-id';
const AGENT2 = 'agent2-investment-advisor-id';
const USER = 'user-subject-123';
const ISSUER = 'https://auth.pingone.com/env-1/as';

function makeConfig(overrides = {}) {
  const map = {
    ff_a2a_delegation: 'true',
    pingone_ai_agent_client_id: AGENT1,
    pingone_ai_agent_client_secret: 'agent1-secret',
    pingone_investment_agent_client_id: AGENT2,
    pingone_investment_agent_client_secret: '',
    a2a_intermediate_audience: 'a2a-intermediate.ping.demo',
    pingone_resource_mcp_gateway_uri: 'mcpgateway.ping.demo',
    a2a_intermediate_scope: 'agent:invoke',
    ...overrides,
  };
  return { getEffective: (k) => (k in map ? map[k] : '') };
}

function makeOauth() {
  const exchanges = [];
  return {
    exchanges,
    oauthService: {
      getAiAgentClientCredentialsToken: jest.fn(async () => fakeJwt({ sub: AGENT1, aud: ['agentgateway.ping.demo'] })),
      getClientCredentialsTokenAs: jest.fn(async (clientId, _secret, aud) => fakeJwt({ sub: clientId, aud: [aud] })),
      performTokenExchangeAs: jest.fn(async (subjectToken, actorToken, clientId, secret, audience, scopes) => {
        exchanges.push({ clientId, secret });
        const s = JSON.parse(Buffer.from(subjectToken.split('.')[1], 'base64url').toString());
        const a = JSON.parse(Buffer.from(actorToken.split('.')[1], 'base64url').toString());
        return fakeJwt({ sub: s.sub, act: s.act ? { sub: a.sub, act: s.act } : { sub: a.sub }, aud: [audience], scope: (scopes || []).join(' ') });
      }),
    },
  };
}

const deps = (oauthService, cfg) => ({
  oauthService,
  configStore: makeConfig(cfg),
  getSessionBearerForMcp: () => fakeJwt({ iss: ISSUER, sub: USER, scope: 'read write' }),
  getIssuer: () => ISSUER,
  scopeTopology: { toolScopes: () => ['invest:read'] },
  sendA2aProtocolHandoff: async ({ tokenEvents }) => ({ ok: true, tokenEvents }),
});

beforeEach(() => mockRelay.manages.mockReset());

test('a managed specialist with no local secret runs the chain, passing no secret', async () => {
  mockRelay.manages.mockImplementation(async (id) => id === AGENT2);
  const { oauthService, exchanges } = makeOauth();

  const result = await a2a.delegateToSpecialist({ session: {} }, { vertical: 'banking', deps: deps(oauthService) });

  expect(result.error).toBeUndefined();
  expect(result.claims.act.sub).toBe(AGENT2);
  expect(exchanges[1].clientId).toBe(AGENT2);
  expect(exchanges[1].secret).toBeFalsy();
});

test('an unmanaged specialist with no secret is still the original credentials error', async () => {
  mockRelay.manages.mockResolvedValue(false);
  const { oauthService, exchanges } = makeOauth();

  const result = await a2a.delegateToSpecialist({ session: {} }, { vertical: 'banking', deps: deps(oauthService) });

  expect(result.token).toBeNull();
  expect(result.error).toMatch(/Investment Advisor.*credentials/i);
  expect(exchanges).toHaveLength(0);
});

test('a specialist with a local secret never asks the sidecar', async () => {
  const { oauthService } = makeOauth();

  const result = await a2a.delegateToSpecialist({ session: {} }, {
    vertical: 'banking',
    deps: deps(oauthService, { pingone_investment_agent_client_secret: 'agent2-secret' }),
  });

  expect(result.error).toBeUndefined();
  expect(mockRelay.manages).not.toHaveBeenCalled();
});
