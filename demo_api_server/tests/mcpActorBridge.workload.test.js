'use strict';

// The bridge tells the gateway which agent is the user's delegate. It must name
// the same agent the token's `act` names, or PingOne Authorize denies the call
// (actor chain mismatch).

const mockConfig = {};
jest.mock('../services/configStore', () => ({ getEffective: jest.fn((key) => mockConfig[key] ?? null) }));

const { buildActorBridgeHeaders } = require('../services/mcpActorBridge');

beforeEach(() => {
  for (const key of Object.keys(mockConfig)) delete mockConfig[key];
  mockConfig.ai_agent_client_id = 'built-in-agent';
});

test('names the built-in agent for an ordinary call', () => {
  expect(buildActorBridgeHeaders()).toEqual({ 'X-Act-Client-Id': 'built-in-agent', 'X-May-Act-Sub': 'built-in-agent' });
});

test('names the workload agent when the workload resource is in use', () => {
  mockConfig.workload_agent_gateway_audience = 'workloadgateway.test';
  expect(buildActorBridgeHeaders({ workloadActorClientId: 'workload-agent' }))
    .toEqual({ 'X-Act-Client-Id': 'workload-agent', 'X-May-Act-Sub': 'workload-agent' });
});

test('keeps the built-in agent for a workload run on the shared resource, where act still names it', () => {
  expect(buildActorBridgeHeaders({ workloadActorClientId: 'workload-agent' }))
    .toEqual({ 'X-Act-Client-Id': 'built-in-agent', 'X-May-Act-Sub': 'built-in-agent' });
});

test('an ordinary call is unaffected by the workload resource being configured', () => {
  mockConfig.workload_agent_gateway_audience = 'workloadgateway.test';
  expect(buildActorBridgeHeaders()['X-May-Act-Sub']).toBe('built-in-agent');
});
