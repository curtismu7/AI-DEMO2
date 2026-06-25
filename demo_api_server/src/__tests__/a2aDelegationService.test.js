'use strict';

/**
 * Unit test for the A2A chained RFC 8693 delegation (Slice 1).
 * Verifies — without a live PingOne tenant — that delegateToSpecialist:
 *   1. performs Exchange #1 (user + Agent 1 actor) then Exchange #2 (Agent 1 token + Agent 2 actor),
 *   2. produces a token whose act chain is nested act:{sub:agent2, act:{sub:agent1}} with sub=user,
 *   3. emits the a2a-* token-chain events in order,
 *   4. requests invest:read (least privilege) in Exchange #2,
 *   5. is a no-op when the feature flag is off.
 */

const a2a = require('../../services/a2aDelegationService');

// Minimal unsigned JWT builder (decodeJwt only base64-decodes the payload).
function fakeJwt(payload, header = { alg: 'RS256', typ: 'JWT' }) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64(header)}.${b64(payload)}.sig`;
}

const AGENT1 = 'agent1-client-id';
const AGENT2 = 'agent2-investment-advisor-id';
const USER = 'user-subject-123';

function makeConfig(overrides = {}) {
  const map = {
    ff_a2a_delegation: 'true',
    pingone_ai_agent_client_id: AGENT1,
    pingone_ai_agent_client_secret: 'agent1-secret',
    pingone_investment_agent_client_id: AGENT2,
    pingone_investment_agent_client_secret: 'agent2-secret',
    a2a_intermediate_audience: 'a2a-intermediate.ping.demo',
    pingone_resource_mcp_gateway_uri: 'mcpgateway.ping.demo',
    a2a_intermediate_scope: 'agent:invoke',
    ...overrides,
  };
  return { getEffective: (k) => (k in map ? map[k] : '') };
}

// Fake SoT: scope-topology.json is the SoT for scopes; the service derives the
// specialist scope from it via the tool. Banking invest tools → invest:read.
function makeScopeTopology() {
  return {
    toolScopes: (tool) =>
      tool && (tool.startsWith('get_investment') || tool === 'get_portfolio_summary')
        ? ['invest:read']
        : ['read'],
  };
}

function makeOauth() {
  const calls = { exchanges: [] };
  const oauthService = {
    getAiAgentClientCredentialsToken: jest.fn(async () => fakeJwt({ sub: AGENT1, aud: ['agentgateway.ping.demo'] })),
    getClientCredentialsTokenAs: jest.fn(async (clientId, _secret, aud, _method, scope) =>
      fakeJwt({ sub: clientId, aud: [aud], scope })),
    performTokenExchangeAs: jest.fn(async (subjectToken, actorToken, clientId, _secret, audience, scopes) => {
      calls.exchanges.push({ subjectToken, clientId, audience, scopes });
      const subjectClaims = JSON.parse(Buffer.from(subjectToken.split('.')[1], 'base64url').toString());
      const actorClaims = JSON.parse(Buffer.from(actorToken.split('.')[1], 'base64url').toString());
      // PingOne nesting model: carry the subject's existing act inward, new actor outside.
      const act = subjectClaims.act
        ? { sub: actorClaims.sub, act: subjectClaims.act }
        : { sub: actorClaims.sub };
      return fakeJwt({ sub: subjectClaims.sub, act, aud: [audience], scope: (scopes || []).join(' ') });
    }),
  };
  return { oauthService, calls };
}

const reqWithToken = () => ({ session: {} });
const sessionBearer = () => fakeJwt({ sub: USER, scope: 'read write' });

describe('a2aDelegationService.delegateToSpecialist (chained RFC 8693)', () => {
  const bankingDeps = (cfgOverrides) => ({
    oauthService: undefined, // set per call
    configStore: makeConfig(cfgOverrides),
    getSessionBearerForMcp: sessionBearer,
    scopeTopology: makeScopeTopology(),
  });

  test('produces nested act:{agent2, act:{agent1}} bound to the user (banking)', async () => {
    const { oauthService, calls } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'banking',
      deps: { ...bankingDeps(), oauthService },
    });

    expect(result.error).toBeUndefined();
    expect(result.token).toBeTruthy();
    expect(result.specialist).toBe('Investment Advisor');
    // subject preserved, nested act chain, no may_act
    expect(result.claims.sub).toBe(USER);
    expect(result.claims.act.sub).toBe(AGENT2);
    expect(result.claims.act.act.sub).toBe(AGENT1);
    expect(result.claims.may_act).toBeUndefined();
    expect(result.actChainDepth).toBe(2);

    // two exchanges, second one chains off the first's output
    expect(calls.exchanges).toHaveLength(2);
    expect(calls.exchanges[0].clientId).toBe(AGENT1);
    expect(calls.exchanges[1].clientId).toBe(AGENT2);
    // Exchange #2's subject IS the output of Exchange #1: it already carries act:{agent1}.
    const ex2Subject = JSON.parse(Buffer.from(calls.exchanges[1].subjectToken.split('.')[1], 'base64url').toString());
    expect(ex2Subject.sub).toBe(USER);
    expect(ex2Subject.act.sub).toBe(AGENT1);
    // Exchange #2 requests the SoT-derived scope (invest:read for banking) — least privilege
    expect(result.scopes).toEqual(['invest:read']);
    expect(calls.exchanges[1].scopes).toEqual(['invest:read']);
    expect(calls.exchanges[1].audience).toBe('mcpgateway.ping.demo');
  });

  test('derives a different scope per vertical from the SoT (healthcare → read)', async () => {
    const { oauthService, calls } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'healthcare',
      deps: { ...bankingDeps({ pingone_records_agent_client_id: 'records-agent', pingone_records_agent_client_secret: 's' }), oauthService },
    });
    expect(result.error).toBeUndefined();
    expect(result.specialist).toBe('Records Specialist');
    expect(result.agent2).toBe('records-agent');
    // sensitive_patient_records → read per the (fake) SoT — scope derived, not re-declared
    expect(result.scopes).toEqual(['read']);
    expect(calls.exchanges[1].scopes).toEqual(['read']);
  });

  test('emits the a2a-* token-chain events in order with nested act on exchange2', async () => {
    const { oauthService } = makeOauth();
    const tokenEvents = [];
    await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'banking',
      tokenEvents,
      deps: { ...bankingDeps(), oauthService },
    });
    const ids = tokenEvents.map((e) => e.id);
    expect(ids).toEqual(['a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2']);

    const ex2 = tokenEvents.find((e) => e.id === 'a2a-exchange2');
    expect(ex2.claims.act.sub).toBe(AGENT2);
    expect(ex2.claims.act.act.sub).toBe(AGENT1);
    expect(ex2.actChainDepth).toBe(2);
    expect(ex2.actPresent).toBe(true);
  });

  test('is a no-op when ff_a2a_delegation is off', async () => {
    const { oauthService, calls } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'banking',
      deps: { ...bankingDeps({ ff_a2a_delegation: 'false' }), oauthService },
    });
    expect(result.token).toBeNull();
    expect(result.error).toMatch(/disabled/i);
    expect(calls.exchanges).toHaveLength(0);
  });

  test('errors when the vertical has no specialist', async () => {
    const { oauthService, calls } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'oauth-teaching',
      deps: { ...bankingDeps(), oauthService },
    });
    expect(result.token).toBeNull();
    expect(result.error).toMatch(/No A2A specialist/i);
    expect(calls.exchanges).toHaveLength(0);
  });

  test('errors clearly when the specialist credentials are missing', async () => {
    const { oauthService } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'banking',
      deps: { ...bankingDeps({ pingone_investment_agent_client_id: '', pingone_investment_agent_client_secret: '' }), oauthService },
    });
    expect(result.token).toBeNull();
    expect(result.error).toMatch(/Investment Advisor.*credentials/i);
  });
});

describe('a2aDelegationService.countActDepth', () => {
  test('counts nested actor depth', () => {
    expect(a2a.countActDepth(null)).toBe(0);
    expect(a2a.countActDepth({ sub: 'a' })).toBe(1);
    expect(a2a.countActDepth({ sub: 'b', act: { sub: 'a' } })).toBe(2);
    expect(a2a.countActDepth({ sub: 'c', act: { sub: 'b', act: { sub: 'a' } } })).toBe(3);
  });
});
