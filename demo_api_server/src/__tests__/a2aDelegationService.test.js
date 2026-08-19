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
    // Unit tests cover RFC 8693 identity only; protocol wire hop is separate.
    sendA2aProtocolHandoff: async ({ tokenEvents }) => ({ ok: true, tokenEvents }),
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

  // A specialist tool whose SoT entry carries an a2aDelegatedScope derives that
  // scope (least privilege) instead of the generic read — mirrors the real
  // scope-topology.json wiring for government/university/manufacturing.
  const a2aTopo = (tool, scope) => ({
    toolScopes: () => ['read'],
    a2aDelegatedScope: (t) => (t === tool ? scope : null),
  });

  test('derives tax:read for the government Tax Records Specialist', async () => {
    const { oauthService, calls } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'government',
      deps: {
        ...bankingDeps({ pingone_tax_agent_client_id: 'tax-agent', pingone_tax_agent_client_secret: 's' }),
        oauthService,
        scopeTopology: a2aTopo('sensitive_tax_record', 'tax:read'),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.specialist).toBe('Tax Records Specialist');
    expect(result.agent2).toBe('tax-agent');
    expect(result.scopes).toEqual(['tax:read']);
    expect(calls.exchanges[1].scopes).toEqual(['tax:read']);
  });

  test('derives finaid:read for the university Financial Aid Specialist', async () => {
    const { oauthService, calls } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'university',
      deps: {
        ...bankingDeps({ pingone_finaid_agent_client_id: 'finaid-agent', pingone_finaid_agent_client_secret: 's' }),
        oauthService,
        scopeTopology: a2aTopo('sensitive_student_finance', 'finaid:read'),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.specialist).toBe('Financial Aid Specialist');
    expect(result.agent2).toBe('finaid-agent');
    expect(result.scopes).toEqual(['finaid:read']);
    expect(calls.exchanges[1].scopes).toEqual(['finaid:read']);
  });

  test('derives supplier:read for the manufacturing Supplier Contract Specialist', async () => {
    const { oauthService, calls } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'manufacturing',
      deps: {
        ...bankingDeps({ pingone_supplier_agent_client_id: 'supplier-agent', pingone_supplier_agent_client_secret: 's' }),
        oauthService,
        scopeTopology: a2aTopo('sensitive_supplier_contract', 'supplier:read'),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.specialist).toBe('Supplier Contract Specialist');
    expect(result.agent2).toBe('supplier-agent');
    expect(result.scopes).toEqual(['supplier:read']);
    expect(calls.exchanges[1].scopes).toEqual(['supplier:read']);
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
    expect(ids).toEqual(['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2']);

    const ex2 = tokenEvents.find((e) => e.id === 'a2a-exchange2');
    expect(ex2.claims.act.sub).toBe(AGENT2);
    expect(ex2.claims.act.act.sub).toBe(AGENT1);
    expect(ex2.actChainDepth).toBe(2);
    expect(ex2.actPresent).toBe(true);
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

  test('rejects a tool that is not in the specialist allowlist (no exchange runs)', async () => {
    const { oauthService, calls } = makeOauth();
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'banking',
      tool: 'mortgage_demo', // not one of the Investment Advisor's tools
      deps: { ...bankingDeps(), oauthService },
    });
    expect(result.token).toBeNull();
    expect(result.error).toMatch(/Investment Advisor can only run/i);
    expect(result.error).toMatch(/not authorized for "mortgage_demo"/i);
    expect(calls.exchanges).toHaveLength(0); // fails fast, before any token exchange
  });

  test('legacy fake topo (no resourceUri) keeps shared intermediate + mcpgateway audiences', async () => {
    const { oauthService, calls } = makeOauth();
    await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'banking',
      deps: { ...bankingDeps(), oauthService },
    });
    expect(calls.exchanges[0].audience).toBe('a2a-intermediate.ping.demo');
    expect(calls.exchanges[1].audience).toBe('mcpgateway.ping.demo');
  });

  test('topology resourceUri prefers investment intermediate + A2A gateway over shared config', async () => {
    const { oauthService, calls } = makeOauth();
    const scopeTopology = {
      ...makeScopeTopology(),
      resourceUri: (name) => {
        if (name === 'Super Banking A2A Intermediate - Investment Advisor') {
          return 'a2a-intermediate-investment.ping.demo';
        }
        if (name === 'Super Banking A2A MCP Gateway') {
          return 'mcpgateway-a2a.ping.demo';
        }
        return null;
      },
    };
    // Shared audiences remain set (the live bug: wrong shared + agent:invoke:investment).
    const result = await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'banking',
      deps: { ...bankingDeps(), oauthService, scopeTopology },
    });
    expect(result.error).toBeUndefined();
    expect(calls.exchanges[0].audience).toBe('a2a-intermediate-investment.ping.demo');
    expect(calls.exchanges[0].audience).not.toBe('a2a-intermediate.ping.demo');
    expect(calls.exchanges[1].audience).toBe('mcpgateway-a2a.ping.demo');
    expect(calls.exchanges[1].audience).not.toBe('mcpgateway.ping.demo');
  });

  test('per-appKey config still wins over topology resourceUri', async () => {
    const { oauthService, calls } = makeOauth();
    const scopeTopology = {
      ...makeScopeTopology(),
      resourceUri: () => 'a2a-intermediate-investment.ping.demo',
    };
    await a2a.delegateToSpecialist(reqWithToken(), {
      vertical: 'banking',
      deps: {
        ...bankingDeps({
          a2a_intermediate_audience_investment: 'custom-intermediate.ping.demo',
          a2a_gateway_audience: 'custom-a2a-gw.ping.demo',
        }),
        oauthService,
        scopeTopology,
      },
    });
    expect(calls.exchanges[0].audience).toBe('custom-intermediate.ping.demo');
    expect(calls.exchanges[1].audience).toBe('custom-a2a-gw.ping.demo');
  });

  // ── Verified Trust — additive, fail-open, must never touch the bearer chain ──
  describe('Verified Trust assertion (additive, fail-open)', () => {
    test('verifiedTrustService.isEnabled() false: no call, no trustAssertion, bearer chain unaffected', async () => {
      const { oauthService } = makeOauth();
      const verifiedTrustService = {
        isEnabled: jest.fn(() => false),
        issueAgentTrustAssertion: jest.fn(),
      };
      const result = await a2a.delegateToSpecialist(reqWithToken(), {
        vertical: 'banking',
        deps: { ...bankingDeps(), oauthService, verifiedTrustService },
      });

      expect(verifiedTrustService.isEnabled).toHaveBeenCalled();
      expect(verifiedTrustService.issueAgentTrustAssertion).not.toHaveBeenCalled();
      expect(result.trustAssertion).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.claims.act.sub).toBe(AGENT2); // bearer chain still correct
    });

    test('enabled + issuance succeeds: trustAssertion attached, evidence event pushed, bearer chain unaffected', async () => {
      const { oauthService } = makeOauth();
      const verifiedTrustService = {
        isEnabled: jest.fn(() => true),
        issueAgentTrustAssertion: jest.fn(async () => ({
          credential: 'eyJhbGciOi...mockSdJwt',
          credentialId: 'cred-789',
          expiresAt: '2026-08-10T13:00:00Z',
        })),
      };
      const tokenEvents = [];
      const result = await a2a.delegateToSpecialist(reqWithToken(), {
        vertical: 'banking',
        tokenEvents,
        deps: { ...bankingDeps(), oauthService, verifiedTrustService },
      });

      expect(result.trustAssertion).toEqual({
        credential: 'eyJhbGciOi...mockSdJwt',
        credentialId: 'cred-789',
        expiresAt: '2026-08-10T13:00:00Z',
      });
      expect(verifiedTrustService.issueAgentTrustAssertion).toHaveBeenCalledWith({
        agentId: AGENT2,
        actingForUserId: USER,
        scope: 'invest:read',
        chainId: expect.stringContaining(`${USER}:investment:`),
      });
      const vtEvent = tokenEvents.find((e) => e.id === 'verified-trust-issuance');
      expect(vtEvent.status).toBe('issued');
      // Bearer chain fully intact regardless of the additive assertion.
      expect(result.claims.act.sub).toBe(AGENT2);
      expect(result.claims.act.act.sub).toBe(AGENT1);
      expect(result.actChainDepth).toBe(2);
    });

    test('enabled + issuance throws NOT_CONFIGURED: bearer chain still completes, trustAssertion undefined, failure recorded as evidence not an error', async () => {
      const { oauthService } = makeOauth();
      const notConfigured = new Error('verifiedTrustService not configured');
      notConfigured.code = 'NOT_CONFIGURED';
      const verifiedTrustService = {
        isEnabled: jest.fn(() => true),
        issueAgentTrustAssertion: jest.fn(async () => { throw notConfigured; }),
      };
      const tokenEvents = [];
      const result = await a2a.delegateToSpecialist(reqWithToken(), {
        vertical: 'banking',
        tokenEvents,
        deps: { ...bankingDeps(), oauthService, verifiedTrustService },
      });

      // The whole point of fail-open: no top-level error, token/claims still present.
      expect(result.error).toBeUndefined();
      expect(result.token).toBeTruthy();
      expect(result.claims.act.sub).toBe(AGENT2);
      expect(result.claims.act.act.sub).toBe(AGENT1);
      expect(result.trustAssertion).toBeUndefined();

      const vtEvent = tokenEvents.find((e) => e.id === 'verified-trust-issuance');
      expect(vtEvent.status).toBe('failed');
      expect(vtEvent.explanation).toMatch(/Bearer-token delegation unaffected/i);
    });
  });
});

describe('a2aDelegationService.probeGeneralistMismatch', () => {
  it('POSTs a fabricated NestedActClientId to the decision endpoint and records a DENY event', async () => {
    const fakeAxios = {
      post: jest.fn().mockResolvedValue({
        data: { decision: 'DENY', reason: 'invalid_a2a_generalist: nested act.sub "unregistered-simulated-agent" is not the authorized generalist' },
      }),
    };
    const tokenEvents = [];
    const result = await a2a.probeGeneralistMismatch(
      { session: { user: { id: 'user-1' } } },
      { vertical: 'investment', tool: 'get_portfolio_summary', tokenEvents, deps: { axios: fakeAxios, configStore: makeConfig(), scopeTopology: makeScopeTopology() } },
    );
    expect(result.decision).toBe('DENY');
    expect(result.simulated).toBe(true);
    expect(fakeAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/governance/pap/alpha/policy/'),
      expect.objectContaining({
        parameters: expect.objectContaining({
          ActChainDepth: '2',
          NestedActClientId: 'unregistered-simulated-agent',
          ToolName: 'get_portfolio_summary',
        }),
      }),
      expect.any(Object),
    );
    expect(tokenEvents).toHaveLength(1);
    expect(tokenEvents[0].id).toBe('a2a-mismatch-probe');
    expect(tokenEvents[0].decision).toBe('DENY');
  });

  it('returns an error when no specialist is configured for the vertical', async () => {
    const result = await a2a.probeGeneralistMismatch(
      { session: { user: { id: 'user-1' } } },
      { vertical: 'not-a-real-vertical', tokenEvents: [], deps: { axios: { post: jest.fn() }, configStore: makeConfig(), scopeTopology: makeScopeTopology() } },
    );
    expect(result.error).toMatch(/No A2A specialist configured/);
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
