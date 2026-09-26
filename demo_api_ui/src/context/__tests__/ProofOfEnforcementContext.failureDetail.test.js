import { computeVerdict } from '../ProofOfEnforcementContext';

// Regression: a failed run showed only "Run failed before token-exchange,
// authorize-decision" — the backend's actual error (gateway_policy_denied,
// mcp_authorize_unavailable, an ENOTFOUND…) was received by completeTrace's
// callers and discarded, so every failure rendered identically and diagnosis
// meant reading container logs. failureDetail now rides the trace and the
// verdict appends the classified cause.

const ENTRY = {
  useCaseId: 'delegated-access-with-proof',
  id: 'UC1',
  title: 'Delegated access (consent only)',
  expectedOutcome: 'PERMIT',
  evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'mcp'] },
};

const baseTrace = (overrides = {}) => ({
  outcome: 'error',
  tokenEvents: [{ id: 'user-token' }],
  mcpResult: null,
  authorize: null,
  ...overrides,
});

test('a failed run with no detail keeps the bare "Run failed before" text', () => {
  const v = computeVerdict(baseTrace(), ENTRY);
  expect(v.state).toBe('incomplete');
  expect(v.resultText).toBe('Run failed before token-exchange, authorize-decision, tool-dispatched');
});

test('a failed run appends the classified failure cause', () => {
  const v = computeVerdict(
    baseTrace({ failureDetail: 'gateway_policy_denied: weather_scope_denied' }),
    ENTRY,
  );
  expect(v.state).toBe('incomplete');
  expect(v.resultText).toContain('Run failed before token-exchange, authorize-decision, tool-dispatched');
  expect(v.resultText).toContain('PingOne Authorize denied the request');
});

test('an authorize-unavailable blob classifies as failing closed', () => {
  const v = computeVerdict(
    baseTrace({ failureDetail: 'mcp_authorize_unavailable — backend unreachable, failing closed' }),
    ENTRY,
  );
  expect(v.resultText).toContain('Authorize backend unreachable');
});

test('a network-level blob classifies as unreachable service', () => {
  const v = computeVerdict(
    baseTrace({ failureDetail: 'getaddrinfo ENOTFOUND ping-gateway' }),
    ENTRY,
  );
  expect(v.resultText).toContain('unreachable');
});

test('a waiting (in-flight) run does NOT show a failure cause', () => {
  const v = computeVerdict(
    baseTrace({ outcome: null, failureDetail: 'gateway_policy_denied' }),
    ENTRY,
  );
  expect(v.resultText).toBe('Waiting on token-exchange, authorize-decision, tool-dispatched');
});

test('an unclassified blob still surfaces verbatim (truncated)', () => {
  const long = 'x'.repeat(300);
  const v = computeVerdict(baseTrace({ failureDetail: long }), ENTRY);
  expect(v.resultText).toContain(`— ${'x'.repeat(160)}`);
  expect(v.resultText.length).toBeLessThan(400);
});
