/**
 * @file agentPreflightBulkParity.test.js
 *
 * Proves the Part 4a extraction (buildMcpDelegationParameters,
 * buildMcpFirstToolGateInputs, decodeMcpTokenFacts) is a PURE MOVE — the bulk
 * pre-flight path (agentPreflightService.evaluateBatch) and the real-time
 * gate (evaluateMcpFirstToolGate / evaluateMcpToolDelegation) build a tool's
 * Trust Framework parameters from the exact same code, not two copies that
 * can drift (the F3 divergence this file's own comments warn about).
 *
 * "Parity" here means wire-level: the JSON body evaluateMcpToolDelegation
 * actually POSTs to PingOne is byte-identical (module Timestamp, which is
 * time-of-call) to calling buildMcpDelegationParameters directly with the
 * same input. See REGRESSION_PLAN.md — this is a protected §1 gate.
 */

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));
jest.mock('../../services/jwksService', () => ({
  hasKid: jest.fn(async () => true),
}));
jest.mock('../../services/oauthEndpointResolver', () => ({
  getIssuer: jest.fn(() => 'https://auth.pingone.com/env-123/as'),
}));

const configStore = require('../../services/configStore');
const svc = require('../../services/pingOneAuthorizeService');
const { buildMcpFirstToolGateInputs, decodeMcpTokenFacts } = require('../../services/mcpToolAuthorizationService');

/** Same fake-JWT convention as mcpToolAuthorizationService.test.js — no signature verification. */
function jwtWithPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `eyJhbGciOiJub25lIiwia2lkIjoia2lkLTEifQ.${body}.x`;
}

const FAKE_TOKEN = jwtWithPayload({
  sub: 'user-1',
  aud: 'mcpgateway.ping.demo',
  act: { client_id: 'agent-client-1' },
  scope: 'mcp:invoke banking:read',
  exp: 9999999999,
  iat: 1000000000,
  nbf: 1000000000,
  iss: 'https://auth.pingone.com/env-123/as',
});

beforeEach(() => {
  jest.clearAllMocks();
  const creds = {
    pingone_environment_id: 'env-123', pingone_region: 'com',
    authorize_worker_client_id: 'worker-id', authorize_worker_client_secret: 'worker-secret',
    authorize_mcp_decision_endpoint_id: 'mcp-ep-1',
  };
  configStore.get.mockImplementation((k) => creds[k] ?? null);
  configStore.getEffective.mockImplementation((k) => creds[k] ?? null);
  svc._resetAuthorizeRuntimeState();
});

describe('buildMcpDelegationParameters — contract', () => {
  test('builds the full McpFirstTool parameter set for a representative input', () => {
    const params = svc.buildMcpDelegationParameters({
      userId: 'user-1',
      toolName: 'create_transfer',
      tokenAudience: 'mcpgateway.ping.demo',
      actClientId: 'agent-client-1',
      nestedActClientId: '',
      mcpResourceUri: 'mcpgateway.ping.demo',
      acr: 'Multi_Factor',
      transactionType: 'transfer',
      hitlApproved: true,
      hitlChallengeId: 'chal-1',
      requiredGroup: 'tellers',
      userGroups: ['tellers'],
      userTier: 'Standard',
      inRequiredGroup: true,
      amount: 2500,
      resourceOwnerId: 'user-1',
      rarMaxAmount: 5000,
      rarPermittedPayees: ['acct-2'],
      toAccountId: 'acct-2',
      verticalId: 'banking',
      clientId: 'user-1',
      mayActSub: 'agent-client-1',
      tokenScopes: 'mcp:invoke banking:read',
      tokenExp: 9999999999,
      tokenIat: 1000000000,
      tokenNbf: 1000000000,
      tokenIss: 'https://auth.pingone.com/env-123/as',
      userRole: 'user',
      tokenKid: 'kid-1',
      tokenKidKnown: true,
    });

    const { Timestamp, ...rest } = params;
    expect(typeof Timestamp).toBe('string');
    expect(rest).toEqual({
      DecisionContext: 'McpFirstTool',
      McpMethod: 'tools/call',
      UserId: 'user-1',
      ToolName: 'create_transfer',
      TokenAudience: 'mcpgateway.ping.demo',
      TokenAudActual: 'mcpgateway.ping.demo',
      ActClientId: 'agent-client-1',
      NestedActClientId: '',
      ActChainDepth: 1,
      McpResourceUri: 'mcpgateway.ping.demo',
      ClientId: 'user-1',
      MayActSub: 'agent-client-1',
      TokenScopes: 'mcp:invoke banking:read',
      TokenExp: 9999999999,
      TokenIat: 1000000000,
      TokenNbf: 1000000000,
      TokenIss: 'https://auth.pingone.com/env-123/as',
      TokenKid: 'kid-1',
      TokenKidKnown: true,
      UserRole: 'user',
      Acr: 'Multi_Factor',
      HitlApproved: true,
      HitlChallengeId: 'chal-1',
      RequiredGroup: 'tellers',
      UserTier: 'Standard',
      InRequiredGroup: true,
      Amount: 2500,
      TransactionAmount: '2500',
      TransactionType: 'transfer',
      ResourceOwnerId: 'user-1',
      RarMaxAmount: 5000,
      RarPermittedPayees: ['acct-2'],
      ToAccountId: 'acct-2',
      Vertical: 'banking',
    });
  });

  test('ActChainDepth is 2 with a nested actor, 0 with none', () => {
    const withNested = svc.buildMcpDelegationParameters({
      userId: 'u', toolName: 't', actClientId: 'a1', nestedActClientId: 'a2',
    });
    expect(withNested.ActChainDepth).toBe(2);

    const withNone = svc.buildMcpDelegationParameters({ userId: 'u', toolName: 't' });
    expect(withNone.ActChainDepth).toBe(0);
  });

  test('C1 rule 3 — an absent optional value is OMITTED, not sent as null/undefined', () => {
    const params = svc.buildMcpDelegationParameters({ userId: 'u', toolName: 't' });
    expect(params).not.toHaveProperty('TokenScopes');
    expect(params).not.toHaveProperty('RequiredGroup');
    expect(params).not.toHaveProperty('HitlApproved');
    expect(params).not.toHaveProperty('RarMaxAmount');
  });
});

describe('wire parity — evaluateMcpToolDelegation POSTs exactly what buildMcpDelegationParameters builds', () => {
  test('same input, same body (mod Timestamp)', async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/as/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ({ decision: 'PERMIT' }), text: async () => '' };
    });

    const opts = {
      decisionEndpointId: 'mcp-ep-1',
      userId: 'user-1',
      toolName: 'create_transfer',
      tokenAudience: 'mcpgateway.ping.demo',
      actClientId: 'agent-client-1',
      amount: 2500,
      transactionType: 'transfer',
      resourceOwnerId: 'user-1',
      verticalId: 'banking',
    };

    await svc.evaluateMcpToolDelegation(opts);

    const decisionCall = global.fetch.mock.calls.find(([u]) => !String(u).endsWith('/as/token'));
    const sentBody = JSON.parse(decisionCall[1].body);
    const { Timestamp: _sentTs, ...sentParams } = sentBody.parameters;

    const directParams = svc.buildMcpDelegationParameters(opts);
    const { Timestamp: _directTs, ...directParamsRest } = directParams;

    expect(sentParams).toEqual(directParamsRest);
  });
});

describe('decodeMcpTokenFacts — pure extraction of Contract C1 token facts', () => {
  test('extracts claims + header facts from a presented token', async () => {
    const facts = await decodeMcpTokenFacts({ req: { session: { user: { role: 'user' } } }, agentToken: FAKE_TOKEN, userSub: null });

    expect(facts.subjectId).toBe('user-1');
    expect(facts.tokenAudience).toBe('mcpgateway.ping.demo');
    expect(facts.actClientId).toBe('agent-client-1');
    expect(facts.nestedActClientId).toBe('');
    expect(facts.tokenScopes).toBe('mcp:invoke banking:read');
    expect(facts.tokenExp).toBe(9999999999);
    expect(facts.tokenIat).toBe(1000000000);
    expect(facts.tokenNbf).toBe(1000000000);
    expect(facts.tokenIss).toBe('https://auth.pingone.com/env-123/as');
    expect(facts.tokenKid).toBe('kid-1');
    expect(facts.tokenKidKnown).toBe(true);
    expect(facts.userRole).toBe('user');
  });

  test('userSub argument wins over an absent token sub, but the token sub wins when userSub is not supplied', async () => {
    const withUserSub = await decodeMcpTokenFacts({ req: { session: {} }, agentToken: FAKE_TOKEN, userSub: 'override-sub' });
    expect(withUserSub.subjectId).toBe('override-sub');

    const withoutUserSub = await decodeMcpTokenFacts({ req: { session: {} }, agentToken: FAKE_TOKEN, userSub: null });
    expect(withoutUserSub.subjectId).toBe('user-1');
  });
});

describe('buildMcpFirstToolGateInputs — facts feed liveDelegationArgs identically to a direct decodeMcpTokenFacts call', () => {
  test('liveDelegationArgs carries the same token facts decodeMcpTokenFacts would return', async () => {
    const req = { session: { user: { role: 'user' } } };
    const inputs = await buildMcpFirstToolGateInputs({
      req, tool: 'create_transfer', agentToken: FAKE_TOKEN, userSub: null, userAcr: 'Multi_Factor', toolParams: { amount: 2500, to_account_id: 'acct-2' },
    });

    expect(inputs.earlyExit).toBeUndefined();
    const facts = await decodeMcpTokenFacts({ req, agentToken: FAKE_TOKEN, userSub: null });

    expect(inputs.liveDelegationArgs.userId).toBe(facts.subjectId);
    expect(inputs.liveDelegationArgs.tokenAudience).toBe(facts.tokenAudience);
    expect(inputs.liveDelegationArgs.actClientId).toBe(facts.actClientId);
    expect(inputs.liveDelegationArgs.nestedActClientId).toBe(facts.nestedActClientId);
    expect(inputs.liveDelegationArgs.tokenScopes).toBe(facts.tokenScopes);
    expect(inputs.liveDelegationArgs.tokenKid).toBe(facts.tokenKid);
    expect(inputs.liveDelegationArgs.tokenKidKnown).toBe(facts.tokenKidKnown);
    expect(inputs.liveDelegationArgs.userRole).toBe(facts.userRole);
    expect(inputs.toolAmount).toBe(2500);
    expect(inputs.transactionType).toBe('transfer');
  });
});
