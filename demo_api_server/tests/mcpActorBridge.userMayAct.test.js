'use strict';

// Task 2 (may_act re-architecture): the consent signal must be per-user.
//
// Rule 2.6 (demo_authz_server, Task 3) denies an agent-mediated call whose
// MayActSub does not match the acting agent — so the bridge's X-May-Act-Sub
// must carry the SIGNED-IN USER's may_act.sub (their actual consent state),
// not a static config value that always matches. Static X-Act-Client-Id is
// correct as-is: it names the agent, and the agent is who is acting.

const mockConfig = {};
jest.mock('../services/configStore', () => ({ getEffective: jest.fn((key) => mockConfig[key] ?? null) }));

const { buildActorBridgeHeaders } = require('../services/mcpActorBridge');

beforeEach(() => {
  for (const key of Object.keys(mockConfig)) delete mockConfig[key];
  mockConfig.ai_agent_client_id = 'built-in-agent';
});

test('userMayActSub overrides the static X-May-Act-Sub (per-user consent)', () => {
  expect(buildActorBridgeHeaders({ userMayActSub: 'agent-77' })).toEqual({
    'X-Act-Client-Id': 'built-in-agent',
    'X-May-Act-Sub': 'agent-77',
  });
});

test('userMayActSub wins over the workload branch too (consent is about the user, not the actor)', () => {
  mockConfig.workload_agent_gateway_audience = 'workloadgateway.test';
  expect(buildActorBridgeHeaders({ workloadActorClientId: 'workload-agent', userMayActSub: 'workload-agent' }))
    .toEqual({ 'X-Act-Client-Id': 'workload-agent', 'X-May-Act-Sub': 'workload-agent' });
});

test('absent userMayActSub falls back to the legacy static resolution', () => {
  expect(buildActorBridgeHeaders()).toEqual({
    'X-Act-Client-Id': 'built-in-agent',
    'X-May-Act-Sub': 'built-in-agent',
  });
});

test('empty-string userMayActSub means "no consent" — the header must be OMITTED, not static', () => {
  // A user who never granted (or revoked) has no may_act on their token.
  // Bridging the static agent id here would fabricate consent.
  const headers = buildActorBridgeHeaders({ userMayActSub: '' });
  expect(headers['X-Act-Client-Id']).toBe('built-in-agent');
  expect(headers).not.toHaveProperty('X-May-Act-Sub');
});
