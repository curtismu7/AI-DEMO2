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
      { id: 'user-token', status: 'active', claims: { sub: 'user-1', iss: ISSUER, aud: ['enduser.ping.demo'] } },
      { id: 'two-ex-agent-actor', status: 'active', claims: { iss: ISSUER, aud: ['agentgateway.ping.demo'] } },
      { id: 'two-ex-exchange1', status: 'exchanged', claims: { sub: 'user-1', iss: ISSUER, scope: 'read agent:invoke' } },
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
