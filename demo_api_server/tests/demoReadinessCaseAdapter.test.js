'use strict';

const { createCaseOperations, evidenceFromAgentInvoke } = require('../services/demoReadinessCaseAdapter');
const { evidenceFailures } = require('../services/demoReadinessExecutionService');
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
      { id: 'two-ex-final-token', status: 'exchanged', claims: { sub: 'user-1', iss: ISSUER, aud: ['https://api.ping.demo:3036/mcp'] } },
      { id: 'gw-authorize', status: decision.toLowerCase(), decision, url: 'https://api.example.test/decision-endpoints/1' },
      { id: 'gw-mcp-audit', mcpAudit: { who: { userSub: 'user-1', agentSub: 'agent-1' }, what: { tool }, where: { routePath: '/mcp' }, how: { decision } } },
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

test.each(['UC38', 'UC44'])('workload-agent step %s is blocked, not run: the readiness identity has no agent', async (id) => {
  const request = jest.fn();
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });
  const row = buildDemoReadinessCatalog().find((item) => item.id === id);
  const result = await operations.verifyPrerequisites({ caseRow: row, vertical: VERTICAL, prerequisites: row.runtimePrerequisitesByVertical[VERTICAL] });
  expect(result.status).toBe('blocked');
  expect(result.reason).toMatch(/workload agent/);
  expect(request).not.toHaveBeenCalled();
});

test('a CIBA step is blocked, not run: it needs an approval on a device', async () => {
  const request = jest.fn();
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });
  const result = await operations.verifyPrerequisites({ caseRow, vertical: VERTICAL, prerequisites: { ...prerequisites, requiredFlags: ['ciba_enabled', ...prerequisites.requiredFlags] } });
  expect(result.status).toBe('blocked');
  expect(result.reason).toMatch(/CIBA/);
  expect(request).not.toHaveBeenCalled();
});

test('prerequisites the worker cannot verify are blocked without touching the BFF', async () => {
  const request = jest.fn();
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });
  const result = await operations.verifyPrerequisites({ caseRow, vertical: VERTICAL, prerequisites: { ...prerequisites, a2aCredentials: true } });
  expect(result).toEqual({ status: 'blocked', reason: 'worker cannot yet verify: A2A credentials' });
  expect(request).not.toHaveBeenCalled();
});

test('execute runs the chip as the UI does and refuses modes it has no adapter for', async () => {
  const calls = [];
  const request = async (path, options) => { calls.push({ path, options }); return { status: 200, body: invokeResponse() }; };
  const operations = createCaseOperations({ request, provider: PROVIDER, expectedIssuer: ISSUER });

  const result = await operations.executeReadinessCase({ caseRow, vertical: VERTICAL, mode: 'agent-chip', behavior, authorization });
  expect(validate(result)).toEqual([]);
  expect(calls[0]).toEqual({ path: '/api/agent/invoke', options: { method: 'POST', body: { prompt: behavior.triggerText, vertical: VERTICAL, useCaseId: 'delegated-access-with-proof' } } });

  await expect(operations.executeReadinessCase({ caseRow, vertical: VERTICAL, mode: 'page', behavior, authorization }))
    .rejects.toMatchObject({ code: 'unsupported-operation' });
});

test('a non-200 from the lane BFF is reported as the observed outcome with no evidence', async () => {
  const operations = createCaseOperations({ request: async () => ({ status: 401, body: {} }), provider: PROVIDER, expectedIssuer: ISSUER });
  await expect(operations.executeReadinessCase({ caseRow, vertical: VERTICAL, mode: 'agent-chip', behavior, authorization }))
    .resolves.toEqual({ observed: 'HTTP_401', evidence: {} });
});
