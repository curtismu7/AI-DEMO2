'use strict';

const { createCaseOperations, evidenceFromAgentInvoke, evidenceFromAttackSim, evidenceFromPageLoad } = require('../services/demoReadinessCaseAdapter');
const { audienceScopeSummary, evidenceFailures } = require('../services/demoReadinessExecutionService');
const { buildDemoReadinessCatalog } = require('../services/demoReadinessCatalog');

const ISSUER = 'https://auth.example.test/env/as';
const PROVIDER = 'pingone';
const VERTICAL = 'sporting-goods';
const caseRow = buildDemoReadinessCatalog().find((row) => row.id === 'UC1');
const behavior = caseRow.expectedBehaviorByVertical[VERTICAL];
const authorization = caseRow.authorizationContractByVertical[VERTICAL];
const prerequisites = caseRow.runtimePrerequisitesByVertical[VERTICAL];

// Shape of a real /api/agent/invoke response for a standard two-exchange chip
// (captured from the local PingOne lane on 2026-10-01, values replaced).
function invokeResponse({ decision = 'PERMIT', tool = authorization.primaryTool, error } = {}) {
  return {
    success: true,
    ...(error ? { error } : {}),
    toolsCalled: [tool],
    tokenEvents: [
      { id: 'user-token', status: 'active', claims: { sub: 'user-1', iss: ISSUER, aud: ['enduser.ping.demo'], scope: 'openid read write' } },
      { id: 'two-ex-agent-actor', status: 'active', claims: { iss: ISSUER, aud: ['agentgateway.ping.demo'] } },
      { id: 'two-ex-exchange1', status: 'exchanged', claims: { sub: 'user-1', iss: ISSUER, aud: ['agentgateway.ping.demo'], scope: 'read agent:invoke' } },
      { id: 'two-ex-final-token', status: 'exchanged', claims: { sub: 'user-1', iss: ISSUER, aud: ['https://api.ping.demo:3036/mcp'], scope: 'gateway:mcp:invoke' } },
      { id: 'gw-authorize', status: decision.toLowerCase(), decision, url: 'https://api.example.test/decision-endpoints/1' },
      { id: 'gw-mcp-audit', mcpAudit: { who: { userSub: 'user-1', agentSub: 'agent-1' }, what: { tool }, where: { routePath: '/mcp' }, how: { decision } } },
      // The gateway's own exchange for the MCP server, reported only when it forwards.
      ...(decision === 'PERMIT' ? [{ id: 'gw-backend-exchange', status: 'active', exchanged: true, audience: 'mcpserver.ping.demo', scope: 'read' }] : []),
    ],
  };
}

const validate = (result, expected = 'PERMIT') => [
  ...(result.observed === expected ? [] : ['observed outcome']),
  ...evidenceFailures({ evidence: result.evidence, provider: PROVIDER, authorization, expected, caseRow }),
];

test('a standard two-exchange PERMIT satisfies the runner contract, including after a JSON round trip', () => {
  const result = evidenceFromAgentInvoke({ response: invokeResponse(), provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  expect(validate(result)).toEqual([]);
  // The worker returns evidence over HTTP: object-valued fields must still match.
  expect(validate(JSON.parse(JSON.stringify(result)))).toEqual([]);
});

test('a PingFederate standard two-exchange PERMIT satisfies the resolved PF contract only with the BFF-reported endpoint and roles', () => {
  const pf = caseRow.pfExchangeContract;
  expect(pf.status).toBe('ready');
  const ALL_ROLES = ['standard-agent-exchanger', 'standard-mcp-exchanger', 'ai-agent-actor', 'mcp-service-actor'];
  // Audiences and scopes as the local PF lane produced them on 2026-10-29.
  const pfResponse = (pfExchange, { pingOneShaped = false } = {}) => {
    const response = invokeResponse();
    const byId = (id) => response.tokenEvents.find((event) => event.id === id);
    for (const event of response.tokenEvents) if (event.claims?.iss) event.claims.iss = pf.issuer;
    if (!pingOneShaped) {
      // The tool scope is first held by Exchange #1, not the PF user token.
      byId('user-token').claims.scope = 'openid ai:agent:read';
      byId('two-ex-exchange1').claims.aud = ['https://agentgateway.ping.demo'];
      byId('two-ex-final-token').claims.scope = ['gateway:mcp:invoke', ...authorization.requiredScopes];
      byId('gw-backend-exchange').audience = 'https://api.ping.demo:3036/mcp';
    }
    if (pfExchange) byId('two-ex-final-token').pfExchange = pfExchange;
    return response;
  };
  const failures = (response) => {
    const result = evidenceFromAgentInvoke({ response, provider: 'pingfederate', expectedIssuer: pf.issuer, authorization });
    return [
      ...(result.observed === 'PERMIT' ? [] : ['observed outcome']),
      ...evidenceFailures({ evidence: JSON.parse(JSON.stringify(result.evidence)), provider: 'pingfederate', authorization, expected: 'PERMIT', caseRow }),
    ];
  };
  expect(failures(pfResponse({ endpoint: pf.endpoint, credentialRoles: ALL_ROLES }))).toEqual([]);
  // No PF report from the BFF, a different endpoint, or a missing role: the row fails.
  expect(failures(pfResponse(null)).join(' ; ')).toMatch(/PF endpoint|configuration is incomplete/);
  expect(failures(pfResponse({ endpoint: 'https://other.example:9031/as/token.oauth2', credentialRoles: ALL_ROLES })).join(' ; ')).toMatch(/PF endpoint/);
  expect(failures(pfResponse({ endpoint: pf.endpoint, credentialRoles: ALL_ROLES.slice(0, 3) })).join(' ; ')).toMatch(/credential role/);
  // PingOne's audiences are not PingFederate's: the PF contract refuses them.
  expect(failures(pfResponse({ endpoint: pf.endpoint, credentialRoles: ALL_ROLES }, { pingOneShaped: true })).join(' ; '))
    .toMatch(/audience set does not match|gateway token audience or scope|exchange for the MCP server/);
});

test('PingOne evidence is still judged against the PingOne contract', () => {
  // The PF overrides exist on the contract but never apply to a PingOne row.
  expect(authorization.providerOverrides?.pingfederate).toBeTruthy();
  expect(validate(evidenceFromAgentInvoke({ response: invokeResponse(), provider: PROVIDER, expectedIssuer: ISSUER, authorization }))).toEqual([]);
});

test('the report lists expected against observed audience and scopes for each hop', () => {
  const { evidence } = evidenceFromAgentInvoke({ response: invokeResponse(), provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  expect(audienceScopeSummary({ evidence, authorization, expected: 'PERMIT' })).toEqual([
    expect.objectContaining({ hop: 'tool scope', expectedScopes: authorization.requiredScopes, observedScopes: ['read'], observedAudiences: ['enduser.ping.demo'] }),
    { hop: 'gateway token', expectedAudiences: ['https://api.ping.demo:3036/mcp'], expectedScopes: ['gateway:mcp:invoke'], observedAudiences: ['https://api.ping.demo:3036/mcp'], observedScopes: ['gateway:mcp:invoke'] },
    { hop: 'gateway to MCP server', expectedAudiences: ['mcpserver.ping.demo'], expectedScopes: ['read'], observedAudiences: ['mcpserver.ping.demo'], observedScopes: ['read'] },
  ]);
});

test('the report shows no gateway-to-server hop for a call that was never forwarded', () => {
  const denied = evidenceFromAgentInvoke({ response: invokeResponse({ decision: 'DENY', error: 'gateway policy denied' }), provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  expect(audienceScopeSummary({ evidence: denied.evidence, authorization, expected: 'DENY' }).map((hop) => hop.hop)).toEqual(['tool scope', 'gateway token']);
  // A permitted call with no reported exchange still lists the hop, so the gap is visible.
  const permitted = evidenceFromAgentInvoke({ response: invokeResponse(), provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  delete permitted.evidence.backendHop;
  expect(audienceScopeSummary({ evidence: permitted.evidence, authorization, expected: 'PERMIT' }).map((hop) => hop.hop)).toContain('gateway to MCP server');
});

test('a DENY is reported from the gateway and Authorize decisions', () => {
  const result = evidenceFromAgentInvoke({ response: invokeResponse({ decision: 'DENY', error: 'gateway policy denied' }), provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  expect(result.observed).toBe('DENY');
  expect(validate(result, 'DENY')).toEqual([]);
});

test.each([
  ['a token from another issuer', (r) => { r.tokenEvents[0].claims.iss = 'https://other.example.test/as'; }, /user-session provider/],
  ['no completed exchange', (r) => { r.tokenEvents[2].status = 'failed'; }, /exchange service/],
  ['a different tool than the contract names', (r) => { r.toolsCalled = ['other_tool']; }, /selected tool|resource server/],
  ['no gateway audit', (r) => { r.tokenEvents = r.tokenEvents.filter((event) => event.id !== 'gw-mcp-audit'); }, /actor chain|Gateway evidence/],
  ['an Authorize decision that differs from the outcome', (r) => { r.tokenEvents[4].decision = 'INDETERMINATE'; }, /Authorize decision/],
  ['a gateway token for another audience', (r) => { r.tokenEvents[3].claims.aud = ['mcpgateway.ping.demo']; }, /gateway token audience or scope/],
  ['a gateway token carrying a tool scope', (r) => { r.tokenEvents[3].claims.scope = 'gateway:mcp:invoke read'; }, /gateway token audience or scope/],
  ['no gateway exchange for the MCP server', (r) => { r.tokenEvents = r.tokenEvents.filter((event) => event.id !== 'gw-backend-exchange'); }, /MCP server audience/],
  ['a gateway exchange for the wrong audience', (r) => { r.tokenEvents[6].audience = 'enduser.ping.demo'; }, /MCP server audience/],
  ['a gateway exchange carrying more than the tool scopes', (r) => { r.tokenEvents[6].scope = 'write read code:search'; }, /exactly the tool scopes/],
])('%s fails the contract instead of being filled in', (_label, mutate, expectedFailure) => {
  const response = invokeResponse();
  mutate(response);
  const result = evidenceFromAgentInvoke({ response, provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  expect(validate(result).join(' ; ')).toMatch(expectedFailure);
});

test('prerequisites arm flags through the lane BFF by use-case slug and pass only when every required flag is armed', async () => {
  const calls = [];
  const request = async (path, options) => { calls.push({ path, options }); return { status: 200, body: { success: true, flags: prerequisites.requiredFlags } }; };
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });

  await expect(operations.verifyPrerequisites({ caseRow, vertical: VERTICAL, prerequisites })).resolves.toEqual({ status: 'pass' });
  expect(calls).toEqual([{ path: '/api/demo-flags/enable', options: { method: 'POST', body: { useCaseId: 'delegated-access-with-proof' } } }]);

  const partial = createCaseOperations({ request: async () => ({ status: 200, body: { success: true, flags: [] } }), provider: PROVIDER, expectedIssuer: ISSUER });
  await expect(partial.verifyPrerequisites({ caseRow, vertical: VERTICAL, prerequisites })).resolves.toMatchObject({ status: 'blocked' });
});

// Shape of a real held call (captured 2026-10-01): PingOne Authorize answers
// INDETERMINATE with an obligation, the gateway's Authorize filter holds the
// call and writes no audit event, and the BFF records its reading as `outcome`.
function heldResponse(outcome, error) {
  const response = invokeResponse();
  response.success = false;
  response.error = error;
  response.tokenEvents = response.tokenEvents
    .filter((event) => event.id !== 'gw-mcp-audit')
    .map((event) => (event.id === 'gw-authorize'
      ? { id: 'gw-authorize', status: 'indeterminate', decision: 'INDETERMINATE', denyingFilter: 'P1AZDecision' }
      : event));
  response.tokenEvents.push({ type: 'mcp_challenge', phase: 'tools/call', url: 'http://ping-gateway:8080/mcp', status: 401 });
  response.mcpAuthorizeEvaluation = {
    decision: 'INDETERMINATE', outcome, engine: 'pingone', decisionId: 'decision-1',
    request: { parameters: { UserId: 'user-1', ActClientId: 'agent-1' } },
  };
  return response;
}

test.each([
  ['STEP_UP', 'step_up_required'],
  ['HITL_REQUIRED', 'hitl_required'],
])('a call held by Authorize reports the interpreted %s outcome and satisfies the contract', (outcome, error) => {
  const result = evidenceFromAgentInvoke({ response: heldResponse(outcome, error), provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  expect(result.observed).toBe(outcome);
  expect(result.evidence.authorize).toEqual({ reference: 'decision-1', decision: outcome, rawDecision: 'INDETERMINATE' });
  expect(result.evidence.gateway).toEqual({ route: '/mcp', verdict: outcome });
  expect(result.evidence.actorChain).toEqual(['user-1', 'agent-1']);
  expect(validate(result, outcome)).toEqual([]);
});

test('an INDETERMINATE decision the BFF did not interpret is not promoted to an outcome', () => {
  const response = heldResponse('STEP_UP', 'step_up_required');
  delete response.mcpAuthorizeEvaluation;
  const result = evidenceFromAgentInvoke({ response, provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  expect(result.evidence.authorize.decision).toBe('INDETERMINATE');
  expect(validate(result, 'STEP_UP').join(' ; ')).toMatch(/Authorize decision/);
});

// ── Enforcement profiles derived from the use case's declared evidence ───────
const rowFor = (id) => {
  const row = buildDemoReadinessCatalog().find((item) => item.id === id);
  return { row, behavior: row.expectedBehaviorByVertical[VERTICAL], authorization: row.authorizationContractByVertical[VERTICAL] };
};
const validateRow = (id, result, expected) => {
  const { row, authorization: contract } = rowFor(id);
  return [
    ...(result.observed === expected ? [] : ['observed outcome']),
    ...evidenceFailures({ evidence: result.evidence, provider: PROVIDER, authorization: contract, expected, caseRow: row }),
  ];
};

test('UC-TOOL1: a scope the user token lacks is accepted on a declared mirror audience, and on no other', () => {
  const { authorization: contract } = rowFor('UC-TOOL1');
  const response = invokeResponse({ tool: contract.primaryTool });
  response.tokenEvents[2].claims.scope = 'code:search agent:invoke';
  response.tokenEvents[6].scope = 'code:search';
  const run = () => evidenceFromAgentInvoke({ response, provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  expect(run().evidence.audiences).toEqual(['agentgateway.ping.demo']);
  expect(validateRow('UC-TOOL1', run(), 'PERMIT')).toEqual([]);
  response.tokenEvents[2].claims.aud = ['enduser.ping.demo'];
  expect(validateRow('UC-TOOL1', run(), 'PERMIT').join(' ; ')).toMatch(/audience set/);
});

test('the catalog derives each step\'s enforcement from its declared evidence chain', () => {
  const enforcement = (id) => rowFor(id).authorization.enforcement;
  expect(enforcement('UC24')).toBe('public-catalog');
  expect(enforcement('UC30')).toBe('gateway-policy');
  expect(enforcement('UC31')).toBe('gateway-policy');
  // The chain is a floor: these omit authorize-decision but are Authorize-backed.
  for (const id of ['UC1', 'UC6', 'UC7', 'UC17', 'UC25', 'UC-TOOL1']) expect(enforcement(id)).toBe('authorize');
});

// Real UC24 shape (2026-10-01): exchange and Authorize reported skipped.
function publicCatalogResponse(tool) {
  return {
    success: true,
    toolsCalled: [tool],
    tokenEvents: [
      { id: 'intent-token', status: 'active' },
      { id: 'token-exchange', status: 'skipped' },
      { id: 'authorize-decision', status: 'skipped' },
      { id: 'tool-dispatched', status: 'success' },
    ],
  };
}

test('UC24: a public-catalog tool passes on the public path and claims nothing else', () => {
  const { authorization: contract } = rowFor('UC24');
  const result = evidenceFromAgentInvoke({ response: publicCatalogResponse(contract.primaryTool), provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  expect(result.evidence).toMatchObject({ publicCatalog: true, gateway: { applicable: false }, authorize: { applicable: false } });
  expect(validateRow('UC24', result, 'PERMIT')).toEqual([]);
});

test('UC24: a delegated call, a wrong tool or a failed dispatch does not satisfy the public-catalog contract', () => {
  const { authorization: contract } = rowFor('UC24');
  const run = (response) => validateRow('UC24', evidenceFromAgentInvoke({ response, provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract }), 'PERMIT').join(' ; ');
  expect(run(invokeResponse({ tool: contract.primaryTool }))).toMatch(/public path/);
  expect(run(publicCatalogResponse('other_tool'))).toMatch(/selected tool/);
  const failed = publicCatalogResponse(contract.primaryTool);
  failed.tokenEvents[3].status = 'error';
  expect(run(failed)).toMatch(/public path/);
});

// Real UC30/UC31 shape: exchanged token, gateway filter audit with no caller
// and no route under `routePath`, and no Authorize event at all.
function gatewayPolicyResponse(tool, decision) {
  const response = invokeResponse({ tool });
  response.success = decision === 'PERMIT';
  if (decision === 'DENY') response.error = 'gateway_policy_denied';
  response.tokenEvents = response.tokenEvents.filter((event) => !['gw-authorize', 'gw-mcp-audit'].includes(event.id));
  response.tokenEvents.find((event) => event.id === 'two-ex-agent-actor').claims.client_id = 'agent-1';
  response.tokenEvents.push({ id: 'gw-mcp-audit', mcpAudit: { who: {}, what: { tool }, where: { route: '/mcp/weather', filter: 'tx-weather-scope.groovy' }, how: { decision, policy: 'ff_weather_mcp_allowed_state' } } });
  return response;
}

test.each([['UC30', 'PERMIT'], ['UC31', 'DENY']])('%s: a gateway-policy %s passes without an Authorize decision', (id, decision) => {
  const { authorization: contract } = rowFor(id);
  const result = evidenceFromAgentInvoke({ response: gatewayPolicyResponse(contract.primaryTool, decision), provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  expect(result.evidence.gateway).toEqual({ route: '/mcp/weather', verdict: decision });
  expect(result.evidence.authorize).toEqual({ applicable: false, decidedBy: 'ff_weather_mcp_allowed_state' });
  expect(result.evidence.actorChain).toEqual(['user-1', 'agent-1']);
  expect(validateRow(id, result, decision)).toEqual([]);
});

test('gateway-policy: the wrong verdict, or an Authorize decision that should not exist, fails', () => {
  const { authorization: contract } = rowFor('UC31');
  const wrongVerdict = evidenceFromAgentInvoke({ response: gatewayPolicyResponse(contract.primaryTool, 'PERMIT'), provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  expect(validateRow('UC31', wrongVerdict, 'DENY').join(' ; ')).toMatch(/Gateway verdict/);
  const withAuthorize = evidenceFromAgentInvoke({ response: invokeResponse({ tool: contract.primaryTool, decision: 'DENY', error: 'gateway policy denied' }), provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  expect(validateRow('UC31', withAuthorize, 'DENY').join(' ; ')).toMatch(/gateway-policy tool must declare Authorize evidence not applicable/);
});

test('an Authorize-backed step still fails when the Authorize decision is missing', () => {
  const response = gatewayPolicyResponse(authorization.primaryTool, 'PERMIT');
  const result = evidenceFromAgentInvoke({ response, provider: PROVIDER, expectedIssuer: ISSUER, authorization });
  expect(validate(result).join(' ; ')).toMatch(/Authorize evidence is required/);
});

const workloadPrerequisites = (id, request) => {
  const row = buildDemoReadinessCatalog().find((item) => item.id === id);
  return createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER })
    .verifyPrerequisites({ caseRow: row, vertical: VERTICAL, prerequisites: row.runtimePrerequisitesByVertical[VERTICAL] });
};

test('UC38 is blocked without touching the BFF: it needs MFA step-up', async () => {
  const request = jest.fn();
  const result = await workloadPrerequisites('UC38', request);
  expect(result).toEqual({ status: 'blocked', reason: expect.stringMatching(/MFA/) });
  expect(request).not.toHaveBeenCalled();
});

test('UC44 is blocked until a workload agent is registered, then runs', async () => {
  const flags = buildDemoReadinessCatalog().find((item) => item.id === 'UC44').runtimePrerequisitesByVertical[VERTICAL].requiredFlags;
  const lane = (agent) => jest.fn(async (path) => (path === '/api/agent-builder/state'
    ? { status: 200, body: { agent } }
    : { status: 200, body: { success: true, flags } }));
  expect(await workloadPrerequisites('UC44', lane(null))).toEqual({ status: 'blocked', reason: expect.stringMatching(/no workload agent/) });
  expect(await workloadPrerequisites('UC44', lane({ id: 'agent-app' }))).toEqual({ status: 'pass' });
});

test('exchange hops report each token\'s own act chain, so a missing act fails an actor-bound step', () => {
  const { authorization: contract } = rowFor('UC44');
  const response = invokeResponse({ tool: contract.primaryTool });
  const run = () => evidenceFromAgentInvoke({ response, provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  expect(validateRow('UC44', run(), 'PERMIT').join(' ; ')).toMatch(/actor-bound exchanges/);
  response.tokenEvents.unshift({ id: 'personal-agent-lookup', status: 'active' });
  response.tokenEvents[3].claims.act = { sub: 'agent-1' };
  response.tokenEvents[4].claims.act = { sub: 'agent-1' };
  // Recorded under an agent other than the one that presented the actor token.
  expect(validateRow('UC44', run(), 'PERMIT').join(' ; ')).toMatch(/must name the workload agent/);
  response.tokenEvents[2].claims.client_id = 'agent-1';
  expect(run().evidence.exchangeHops).toEqual([{ subject: 'user-1', actorChain: ['user-1', 'agent-1'] }, { subject: 'user-1', actorChain: ['user-1', 'agent-1'] }]);
  expect(validateRow('UC44', run(), 'PERMIT')).toEqual([]);
});

test('a STEP_UP step is blocked when the MFA service cannot serve the identity, and runs when it can', async () => {
  const row = buildDemoReadinessCatalog().find((item) => item.expectedBehaviorByVertical?.[VERTICAL]?.expectedOutcome === 'STEP_UP');
  const stepUpPrerequisites = row.runtimePrerequisitesByVertical[VERTICAL];
  const lane = (mfaStatus) => jest.fn(async (path) => {
    if (path === '/api/auth/mfa/devices') return { status: mfaStatus, body: mfaStatus === 200 ? { devices: [] } : { error: 'list_devices_failed' } };
    if (path === '/api/agent-authorization/status') return { status: 200, body: { authorized: true } };
    return { status: 200, body: { success: true, flags: stepUpPrerequisites.requiredFlags } };
  });
  const verify = (request) => createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER })
    .verifyPrerequisites({ caseRow: row, vertical: VERTICAL, prerequisites: stepUpPrerequisites });
  expect(await verify(lane(500))).toEqual({ status: 'blocked', reason: expect.stringMatching(/MFA service.*HTTP 500: list_devices_failed/) });
  expect(await verify(lane(200))).toEqual({ status: 'pass' });
});

describe('agent consent for consent-gated tools', () => {
  const catalog = buildDemoReadinessCatalog();
  const uc48 = catalog.find((row) => row.id === 'UC48');
  const verify = (request, row, vertical) => createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER })
    .verifyPrerequisites({ caseRow: row, vertical, prerequisites: row.runtimePrerequisitesByVertical[vertical] });
  // A lane BFF stub: consent state, the grant, and the flag arming every step needs.
  const lane = ({ authorized, grant = { status: 200, body: { ok: true } } }) => jest.fn(async (path, options) => {
    if (path === '/api/agent-authorization/status') return { status: 200, body: { authorized } };
    if (path === '/api/agent-authorization/grant') return grant;
    return { status: 200, body: { success: true, flags: uc48.runtimePrerequisitesByVertical.airlines.requiredFlags } };
  });
  const paths = (request) => request.mock.calls.map(([path, options]) => `${options?.method} ${path}`);

  test('the readiness user grants consent once, as a presenter would, before a consent-gated step', async () => {
    expect(uc48.authorizationContractByVertical.airlines.gatewayTool).toMatchObject({ requiresAgentMediation: true, a2aDelegated: false });
    const request = lane({ authorized: false });
    await expect(verify(request, uc48, 'airlines')).resolves.toEqual({ status: 'pass' });
    expect(paths(request).slice(0, 2)).toEqual(['GET /api/agent-authorization/status', 'POST /api/agent-authorization/grant']);
  });

  test('an existing grant is not granted again, and a failed grant blocks the step', async () => {
    const granted = lane({ authorized: true });
    await expect(verify(granted, uc48, 'airlines')).resolves.toEqual({ status: 'pass' });
    expect(paths(granted)).not.toContain('POST /api/agent-authorization/grant');
    await expect(verify(lane({ authorized: false, grant: { status: 503, body: { error: 'agent_not_configured' } } }), uc48, 'airlines'))
      .resolves.toEqual({ status: 'blocked', reason: "lane could not record the user's agent consent (HTTP 503)" });
  });

  test('a step whose tool is not consent-gated never touches consent', async () => {
    const request = jest.fn(async () => ({ status: 200, body: { success: true, flags: prerequisites.requiredFlags } }));
    await verify(request, caseRow, VERTICAL);
    expect(paths(request).some((call) => call.includes('agent-authorization'))).toBe(false);
  });
});

test('a CIBA step is blocked, not run: it needs an approval on a device', async () => {
  const request = jest.fn();
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });
  const result = await operations.verifyPrerequisites({ caseRow, vertical: VERTICAL, prerequisites: { ...prerequisites, requiredFlags: ['ciba_enabled', ...prerequisites.requiredFlags] } });
  expect(result.status).toBe('blocked');
  expect(result.reason).toMatch(/CIBA/);
  expect(request).not.toHaveBeenCalled();
});

// Shape of a real UC2 response (local PingOne lane, 2026-10-01, values replaced).
function a2aResponse({ decision = 'PERMIT', agent2 = 'acquired' } = {}) {
  const nested = { sub: 'specialist-1', act: { sub: 'generalist-1' } };
  return {
    success: decision === 'PERMIT',
    toolsCalled: ['delegate_to_specialist'],
    tokenEvents: [
      { type: 'mcp_challenge', phase: 'tools/call', url: 'http://mcp-gateway:3005/mcp', status: 401 },
      { id: 'user-token', status: 'active', claims: { sub: 'user-1', iss: ISSUER, aud: ['enduser.ping.demo'], scope: 'openid read' } },
      { id: 'a2a-agent1-actor', status: 'acquired', claims: { iss: ISSUER, client_id: 'generalist-1' } },
      { id: 'a2a-exchange1', status: 'exchanged', claims: { sub: 'user-1', iss: ISSUER, aud: ['a2a-intermediate-membership.ping.demo'], scope: 'agent:invoke:membership', act: { sub: 'generalist-1' } } },
      { id: 'a2a-agent2-actor', status: agent2, claims: { iss: ISSUER, client_id: 'specialist-1' } },
      { id: 'a2a-exchange2', status: 'exchanged', claims: { sub: 'user-1', iss: ISSUER, aud: ['mcpgateway-a2a.ping.demo'], scope: 'membership:read', act: nested } },
      { id: 'gw-authorize', status: decision.toLowerCase(), decision, authorizeEngine: 'mock', decisionId: 'decision-1', url: null },
      { id: 'gw-filter-chain', status: 'active', tool: 'sensitive_membership_details' },
    ],
  };
}

test('UC2: an A2A run is judged on the specialist scope, its gateway audience and the nested actor chain', () => {
  const { authorization: contract } = rowFor('UC2');
  const result = evidenceFromAgentInvoke({ response: a2aResponse(), provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  expect(result.evidence).toMatchObject({
    exchangePath: 'a2a-access-token',
    actorChain: ['user-1', 'specialist-1', 'generalist-1'],
    scopes: ['membership:read'],
    audiences: ['mcpgateway-a2a.ping.demo'],
    authorize: { decision: 'PERMIT', engine: 'mock' },
  });
  // The manifest lists the tool as group-restricted, but group policy is opt-in
  // per step (UC9, UC21, or the global flag) and UC2 does not opt in, so no
  // group evidence is owed. A step that does opt in still owes it.
  expect(contract.authorizeToolGroup.enforced).toBe(false);
  expect(validateRow('UC2', result, 'PERMIT')).toEqual([]);
  const optedIn = { ...contract, authorizeToolGroup: { ...contract.authorizeToolGroup, enforced: true } };
  expect(evidenceFailures({ evidence: result.evidence, provider: PROVIDER, authorization: optedIn, expected: 'PERMIT', caseRow: rowFor('UC2').row }))
    .toEqual(['role applicability does not match Authorize role contract']);
});

test('UC2.6: the real delegation is permitted, then the unregistered generalist is denied', () => {
  const { authorization: contract } = rowFor('UC2.6');
  const run = (probeDecision) => {
    const response = a2aResponse();
    response.tokenEvents.push({ id: 'a2a-mismatch-probe', status: 'denied', decision: probeDecision });
    return evidenceFromAgentInvoke({ response, provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  };
  expect(run('DENY').observed).toBe('PERMIT_THEN_DENY');
  expect(validateRow('UC2.6', run('DENY'), 'PERMIT_THEN_DENY')).toEqual([]);
  // The defect seen live on 2026-10-02: the probe was permitted.
  expect(validateRow('UC2.6', run('PERMIT'), 'PERMIT_THEN_DENY')).toEqual(['observed outcome']);
});

test('UC2: a wrong audience, or a specialist that never authenticated, fails', () => {
  const { authorization: contract } = rowFor('UC2');
  const wrongAudience = a2aResponse();
  wrongAudience.tokenEvents[5].claims.aud = ['agentgateway.ping.demo'];
  expect(validateRow('UC2', evidenceFromAgentInvoke({ response: wrongAudience, provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract }), 'PERMIT').join(' ; ')).toMatch(/audience set/);
  const noSpecialist = evidenceFromAgentInvoke({ response: a2aResponse({ agent2: 'failed' }), provider: PROVIDER, expectedIssuer: ISSUER, authorization: contract });
  expect(noSpecialist.evidence.roleApplicability.agentIdentity).toBe(false);
});

test('prerequisites the worker cannot verify are blocked without touching the BFF', async () => {
  const request = jest.fn();
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });
  const result = await operations.verifyPrerequisites({ caseRow, vertical: VERTICAL, prerequisites: { ...prerequisites, parConfig: true } });
  expect(result).toEqual({ status: 'blocked', reason: 'worker cannot yet verify: PAR configuration' });
  expect(request).not.toHaveBeenCalled();
});

test('execute runs the chip as the UI does and refuses behaviors it has no adapter for', async () => {
  const calls = [];
  const request = async (path, options) => { calls.push({ path, options }); return { status: 200, body: invokeResponse() }; };
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });

  const result = await operations.executeReadinessCase({ caseRow, vertical: VERTICAL, mode: 'agent-chip', behavior, authorization });
  expect(validate(result)).toEqual([]);
  expect(calls.slice(0, 2)).toEqual([{ path: '/api/verticals/active', options: { method: 'POST', body: { id: VERTICAL } } }, { path: '/api/agent/invoke', options: { method: 'POST', body: { prompt: behavior.triggerText, vertical: VERTICAL, useCaseId: 'delegated-access-with-proof' } } }]);

  await expect(operations.executeReadinessCase({ caseRow, vertical: VERTICAL, mode: 'education-panel', behavior: { kind: 'education-panel', panel: 'x' }, authorization }))
    .rejects.toMatchObject({ code: 'unsupported-operation' });
  // A page step with no browser configured is not run either.
  await expect(operations.executeReadinessCase({ caseRow, vertical: VERTICAL, mode: 'page', behavior: { kind: 'page-load', path: '/weather-mcp', pathname: '/weather-mcp' }, authorization }))
    .rejects.toMatchObject({ code: 'unsupported-operation' });
});

test('UC48: a link step whose vertical defines a chip runs that chip through the agent', async () => {
  const uc48 = buildDemoReadinessCatalog().find((row) => row.id === 'UC48');
  const calls = [];
  const request = async (path, options) => { calls.push({ path, options }); return { status: 200, body: invokeResponse() }; };
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });
  await operations.executeReadinessCase({ caseRow: uc48, vertical: 'airlines', mode: uc48.executionMode, behavior: uc48.expectedBehaviorByVertical.airlines, authorization: uc48.authorizationContractByVertical.airlines });
  expect(uc48.executionMode).toBe('page');
  expect(calls).toEqual([{ path: '/api/verticals/active', options: { method: 'POST', body: { id: 'airlines' } } }, { path: '/api/agent/invoke', options: { method: 'POST', body: { prompt: 'book a flight from San Francisco to Paris for me under $800', vertical: 'airlines', useCaseId: 'consumer-agent-booking' } } }]);
});

describe('PingFederate A2A delegation', () => {
  const uc2 = buildDemoReadinessCatalog().find((row) => row.id === 'UC2');
  const pf = uc2.pfExchangeContract;
  const SUB = 'readiness-pingfederate-local';
  // Event shapes as the local PF lane produced them for UC2 on 2026-10-31
  // (client ids replaced): an ID-JAG at Exchange #1, an access token for
  // PingGateway at Exchange #2, scopes as a list.
  const a2aResponse = (vertical, { exchange1 = {}, exchange2 = {} } = {}) => {
    const authorization = uc2.authorizationContractByVertical[vertical];
    const tool = authorization.primaryTool;
    const specialistScope = authorization.gatewayTool.a2aDelegatedScope || authorization.requiredScopes[0];
    return { success: true, toolsCalled: ['delegate_to_specialist'], tokenEvents: [
      { id: 'user-token', status: 'active', claims: { iss: pf.issuer, aud: 'enduser.ping.demo', sub: SUB, scope: 'openid ai:agent:read' } },
      { id: 'a2a-agent1-actor', status: 'acquired', claims: { iss: pf.issuer, client_id: 'gen-1' } },
      { id: 'a2a-exchange1', status: 'exchanged', tokenTyp: 'oauth-id-jag+jwt', claims: { iss: pf.issuer, sub: SUB, act: { sub: 'gen-1' } }, pfExchange: { endpoint: pf.endpoint, credentialRoles: ['standard-agent-exchanger', 'ai-agent-actor'] }, ...exchange1 },
      { id: 'a2a-agent2-actor', status: 'acquired', claims: { iss: pf.issuer, client_id: 'spec-1' } },
      { id: 'a2a-exchange2', status: 'exchanged', tokenTyp: 'JWT', claims: { iss: pf.issuer, aud: 'https://api.ping.demo:3036/mcp', sub: SUB, scope: ['gateway:mcp:invoke', specialistScope], act: { sub: 'spec-1', act: { sub: 'gen-1' } } }, pfExchange: { endpoint: pf.endpoint, credentialRoles: ['a2a-specialist'] }, ...exchange2 },
      { id: 'gw-authorize', status: 'permit', decision: 'PERMIT', url: 'https://api.example.test/decision-endpoints/1', tool },
      { id: 'gw-mcp-audit', mcpAudit: { who: { userSub: SUB, agentSub: 'spec-1' }, what: { tool }, where: { routePath: '/mcp' }, how: { decision: 'PERMIT' } } },
      { id: 'gw-filter-chain', status: 'active', tool },
    ] };
  };
  const failuresFor = (vertical, overrides) => {
    const authorization = uc2.authorizationContractByVertical[vertical];
    const result = evidenceFromAgentInvoke({ response: a2aResponse(vertical, overrides), provider: 'pingfederate', expectedIssuer: pf.issuer, authorization });
    return [
      ...(result.observed === 'PERMIT' ? [] : ['observed outcome']),
      ...evidenceFailures({ evidence: JSON.parse(JSON.stringify(result.evidence)), provider: 'pingfederate', authorization, expected: 'PERMIT', caseRow: uc2 }),
    ];
  };

  test('the resolved PF A2A contract is met by an ID-JAG then an access token, with every role the BFF reports', () => {
    expect(pf.status).toBe('ready');
    for (const vertical of ['banking', 'airlines', 'healthcare']) expect(failuresFor(vertical)).toEqual([]);
  });

  test('a role the BFF did not report, two endpoints, or a first hop that is not an ID-JAG fails', () => {
    expect(failuresFor('airlines', { exchange2: { pfExchange: { endpoint: pf.endpoint, credentialRoles: [] } } }))
      .toContain('PF exchanger credential role does not match the declared PF-only role');
    expect(failuresFor('airlines', { exchange1: { pfExchange: { endpoint: 'https://pingfederate:9031/other', credentialRoles: ['standard-agent-exchanger', 'ai-agent-actor'] } } }))
      .toContain('PF endpoint or issuer does not match the declared token contract');
    expect(failuresFor('airlines', { exchange1: { tokenTyp: 'JWT' } }))
      .toContain('PF A2A requires ordered intermediate ID-JAG then Exchange #2 access token');
  });
});

describe('A2A specialist calls held for approval', () => {
  const uc2 = buildDemoReadinessCatalog().find((row) => row.id === 'UC2');
  const run = (request, row, vertical) => createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER })
    .executeReadinessCase({ caseRow: row, vertical, behavior: row.expectedBehaviorByVertical[vertical], authorization: row.authorizationContractByVertical[vertical] });
  const HELD = { success: false, error: 'hitl_required', hitlChallengeId: 'ch-1', action: 'sensitive_passenger_record', tokenEvents: [] };
  const lane = ({ approve = { status: 200, body: { status: 'approved' } } } = {}) => {
    let invokes = 0;
    return jest.fn(async (path) => {
      if (path === '/api/verticals/active') return { status: 204, body: null };
      if (path === '/api/mcp/decision/ch-1/approve') return approve;
      invokes += 1;
      return { status: 200, body: invokes === 1 ? HELD : { success: true, tokenEvents: [] } };
    });
  };
  const calls = (request) => request.mock.calls.map(([path, options]) => `${options?.method} ${path}`);

  test('a step that expects the delegated call to run approves it as the presenter does, then resends once with the challenge', async () => {
    expect(uc2.authorizationContractByVertical.airlines.gatewayTool).toMatchObject({ challengeType: 'consent', a2aDelegated: true });
    const request = lane();
    await run(request, uc2, 'airlines');
    expect(calls(request)).toEqual(['POST /api/verticals/active', 'POST /api/agent/invoke', 'POST /api/mcp/decision/ch-1/approve', 'POST /api/agent/invoke']);
    expect(request.mock.calls[3][1].body).toMatchObject({ prompt: uc2.expectedBehaviorByVertical.airlines.triggerText, hitlChallengeId: 'ch-1' });
  });

  test('a failed approval is the outcome; nothing is resent', async () => {
    const request = lane({ approve: { status: 403, body: { error: 'forbidden' } } });
    await expect(run(request, uc2, 'airlines')).resolves.toEqual({ observed: 'HITL_APPROVE_HTTP_403', evidence: {} });
    expect(calls(request).filter((call) => call.endsWith('/api/agent/invoke'))).toHaveLength(1);
  });

  test('a held call outside A2A delegation is left held', async () => {
    const request = lane();
    await run(request, caseRow, VERTICAL);
    expect(calls(request).some((call) => call.includes('/api/mcp/decision'))).toBe(false);
  });
});

describe('A2A orchestrator steps', () => {
  const uc25 = buildDemoReadinessCatalog().find((row) => row.id === 'UC2.5');
  const run = (request, vertical = 'airlines') => createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER })
    .executeReadinessCase({ caseRow: uc25, vertical, behavior: uc25.expectedBehaviorByVertical[vertical], authorization: uc25.authorizationContractByVertical[vertical] });
  const calls = (request) => request.mock.calls.map(([path, options]) => `${options?.method} ${path}`);
  const DELIVERED = { status: 200, body: { success: true, toolsCalled: ['orchestrate_delegation'], tokenEvents: [] } };
  const HELD = { status: 502, body: { success: false, error: 'delegation_execution_failed', delegationDecision: { error: 'hitl_required', result: { error: 'hitl_required', challengeId: 'ch-1' } } } };
  const lane = (messages, approve = { status: 200, body: {} }) => {
    const queue = [...messages];
    return jest.fn(async (path) => {
      if (path === '/api/verticals/active') return { status: 204, body: null };
      if (path === '/api/a2a/init') return { status: 200, body: { initialized: true } };
      if (path === '/api/mcp/decision/ch-1/approve') return approve;
      return queue.shift();
    });
  };

  test('runs init then one message with the step\'s trigger text', async () => {
    const request = lane([DELIVERED]);
    const result = await run(request);
    expect(calls(request)).toEqual(['POST /api/verticals/active', 'POST /api/a2a/init', 'POST /api/a2a/message']);
    expect(request.mock.calls[2][1].body).toEqual({ message: uc25.expectedBehaviorByVertical.airlines.triggerText, vertical: 'airlines' });
    expect(result.observed).toBe('PERMIT');
  });

  test('a delegation the gateway held is approved and resent once with the challenge', async () => {
    const request = lane([HELD, DELIVERED]);
    await run(request);
    expect(calls(request).slice(2)).toEqual(['POST /api/a2a/message', 'POST /api/mcp/decision/ch-1/approve', 'POST /api/a2a/message']);
    expect(request.mock.calls[4][1].body).toMatchObject({ hitlChallengeId: 'ch-1' });
  });

  test('a failed approval is the outcome, and a failed init stops the step', async () => {
    const refused = lane([HELD], { status: 403, body: {} });
    await expect(run(refused)).resolves.toEqual({ observed: 'HITL_APPROVE_HTTP_403', evidence: {} });
    expect(calls(refused).filter((call) => call.endsWith('/api/a2a/message'))).toHaveLength(1);
    const noInit = jest.fn(async (path) => (path === '/api/a2a/init' ? { status: 401, body: {} } : { status: 204, body: null }));
    await expect(run(noInit)).resolves.toEqual({ observed: 'HTTP_401', evidence: {} });
  });
});

describe('attack steps', () => {
  const catalog = buildDemoReadinessCatalog();
  const uc5 = catalog.find((row) => row.id === 'UC5');
  const uc10 = catalog.find((row) => row.id === 'UC10');
  const attackBehavior = (row) => row.expectedBehaviorByVertical.banking;
  const judge = (row, result) => [
    ...(result.observed === attackBehavior(row).expectedOutcome ? [] : ['observed outcome']),
    ...evidenceFailures({ evidence: result.evidence, provider: PROVIDER, authorization: row.authorizationContractByVertical.banking, expected: attackBehavior(row).expectedOutcome, caseRow: row, behavior: attackBehavior(row) }),
  ];
  // Shapes of real /api/demo/attack-sim/run responses (local PingFederate lane, 2026-10-30, values replaced).
  const scopeRefusal = {
    sim: 'insufficient-scope', status: 403, errorCode: 'insufficient_scope',
    tokenChainEvents: [
      { id: 'user-token', status: 'active', claims: { sub: 'user-1', iss: ISSUER } },
      { id: 'sim-exchange-ok', status: 'active' },
      { id: 'sim-gateway-deny', status: 'error' },
    ],
  };
  const ownerRefusal = {
    sim: 'cross-owner-account', status: 403, errorCode: 'resource_owner_mismatch', authorize: { decision: 'DENY', decisionId: 'decision-1' },
    tokenChainEvents: [{ id: 'user-token', status: 'active', claims: { sub: 'user-1', iss: ISSUER } }],
  };

  test('the refusal status is the outcome, and the refusal must be on the trace', () => {
    expect(judge(uc5, evidenceFromAttackSim({ response: scopeRefusal, provider: PROVIDER, expectedIssuer: ISSUER }))).toEqual([]);
    const silent = { ...scopeRefusal, tokenChainEvents: scopeRefusal.tokenChainEvents.filter((event) => event.status !== 'error') };
    expect(judge(uc5, evidenceFromAttackSim({ response: silent, provider: PROVIDER, expectedIssuer: ISSUER })))
      .toEqual(['the refusal is not on the attack trace']);
  });

  test('an Authorize decision is the outcome when the sim reports one', () => {
    const result = evidenceFromAttackSim({ response: ownerRefusal, provider: PROVIDER, expectedIssuer: ISSUER });
    expect(result.observed).toBe('DENY');
    expect(judge(uc10, result)).toEqual([]);
  });

  test('a permitted attack, the wrong sim, or another provider\'s session fails', () => {
    expect(judge(uc5, evidenceFromAttackSim({ response: { ...scopeRefusal, status: 200 }, provider: PROVIDER, expectedIssuer: ISSUER })))
      .toContain('observed outcome');
    expect(judge(uc5, evidenceFromAttackSim({ response: { ...scopeRefusal, sim: 'wrong-aud' }, provider: PROVIDER, expectedIssuer: ISSUER })))
      .toEqual(['attack simulation does not match catalog contract']);
    expect(judge(uc5, evidenceFromAttackSim({ response: scopeRefusal, provider: PROVIDER, expectedIssuer: 'https://other.example.test' })))
      .toEqual(['user-session provider is missing or does not match provider lane']);
  });

  test('execute posts the catalog sim to the attack simulator', async () => {
    const calls = [];
    const request = async (path, options) => { calls.push({ path, options }); return { status: 200, body: scopeRefusal }; };
    const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });
    const result = await operations.executeReadinessCase({ caseRow: uc5, vertical: 'banking', mode: uc5.executionMode, behavior: attackBehavior(uc5), authorization: uc5.authorizationContractByVertical.banking });
    expect(calls).toEqual([{ path: '/api/verticals/active', options: { method: 'POST', body: { id: 'banking' } } }, { path: '/api/demo/attack-sim/run', options: { method: 'POST', body: { sim: 'insufficient-scope' } } }]);
    expect(result.observed).toBe('DENY_403');
  });
});

describe('page steps', () => {
  const uc32 = buildDemoReadinessCatalog().find((row) => row.id === 'UC32');
  const pageBehavior = uc32.expectedBehaviorByVertical.banking;
  const judge = (result) => [
    ...(result.observed === 'page-load' ? [] : ['observed outcome']),
    ...evidenceFailures({ evidence: result.evidence, provider: PROVIDER, authorization: uc32.authorizationContractByVertical.banking, expected: 'page-load', caseRow: uc32, behavior: pageBehavior }),
  ];
  const loaded = {
    status: 200, finalPathname: '/weather-mcp', rendered: true, errorBoundary: false, pageErrors: [], failedApiCalls: [],
    session: { authenticated: true, oauthIssuer: ISSUER },
  };
  const evidence = (load) => evidenceFromPageLoad({ load, provider: PROVIDER, expectedIssuer: ISSUER });

  test('a page that rendered on its route as the lane user passes', () => {
    expect(judge(evidence(loaded))).toEqual([]);
  });

  test('an error screen, a thrown error, a failed API call, a redirect or a signed-out page fails', () => {
    expect(judge(evidence({ ...loaded, errorBoundary: true }))).toEqual(['observed outcome', 'page showed the error screen']);
    expect(judge(evidence({ ...loaded, pageErrors: ['TypeError: x is undefined'] }))).toEqual(['page threw an uncaught error']);
    expect(judge(evidence({ ...loaded, failedApiCalls: ['GET /api/weather 502'] }))).toEqual(['a page API call failed with a server error']);
    expect(judge(evidence({ ...loaded, finalPathname: '/' }))).toEqual(['page left its route']);
    expect(judge(evidence({ ...loaded, session: { authenticated: false, oauthIssuer: null } }))).toEqual(['page did not see the lane\'s signed-in session']);
  });

  test('execute loads the catalog path in the browser', async () => {
    const load = jest.fn(async () => loaded);
    const operations = createCaseOperations({ request: jest.fn(async () => ({ status: 204, body: '' })), provider: PROVIDER, expectedIssuer: ISSUER, page: { load, freshness: () => ({ current: true }) } });
    const result = await operations.executeReadinessCase({ caseRow: uc32, vertical: 'banking', mode: 'page', behavior: pageBehavior, authorization: uc32.authorizationContractByVertical.banking });
    expect(load).toHaveBeenCalledWith('/weather-mcp');
    expect(judge(result)).toEqual([]);
  });

  test('a page step is blocked without a browser, or when the UI build is stale', async () => {
    const prerequisitesFor = uc32.runtimePrerequisitesByVertical.banking;
    const without = createCaseOperations({ request: jest.fn(), provider: PROVIDER, expectedIssuer: ISSUER });
    await expect(without.verifyPrerequisites({ caseRow: uc32, vertical: 'banking', prerequisites: prerequisitesFor }))
      .resolves.toEqual({ status: 'blocked', reason: 'no headless browser is configured for this worker' });
    const stale = createCaseOperations({ request: jest.fn(), provider: PROVIDER, expectedIssuer: ISSUER, page: { load: jest.fn(), freshness: () => ({ current: false, reason: 'UI build is older than the UI source' }) } });
    await expect(stale.verifyPrerequisites({ caseRow: uc32, vertical: 'banking', prerequisites: prerequisitesFor }))
      .resolves.toEqual({ status: 'blocked', reason: 'UI build is older than the UI source' });
  });
});

test('each step pins the session to its vertical first, as the UI does, and stops if it cannot', async () => {
  const request = jest.fn(async () => ({ status: 404, body: { error: 'unknown id' } }));
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });
  await expect(operations.executeReadinessCase({ caseRow, vertical: VERTICAL, mode: 'agent-chip', behavior, authorization }))
    .resolves.toEqual({ observed: 'VERTICAL_HTTP_404', evidence: {} });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/api/verticals/active', { method: 'POST', body: { id: VERTICAL } });
});

test('a non-200 from the lane BFF is reported as the observed outcome with no evidence', async () => {
  const operations = createCaseOperations({ request: async (path) => (path === '/api/verticals/active' ? { status: 204, body: '' } : { status: 401, body: {} }), provider: PROVIDER, expectedIssuer: ISSUER });
  await expect(operations.executeReadinessCase({ caseRow, vertical: VERTICAL, mode: 'agent-chip', behavior, authorization }))
    .resolves.toEqual({ observed: 'HTTP_401', evidence: {} });
});
