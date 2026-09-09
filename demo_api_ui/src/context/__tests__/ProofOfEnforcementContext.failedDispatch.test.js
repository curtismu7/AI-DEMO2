import { computeVerdict } from '../ProofOfEnforcementContext';

// Regression: the proof surface rendered "Verified" over a tool call that never
// succeeded. `trace.outcome` is derived from the TRANSPORT, so an HTTP 200 whose
// body carries a tool failure leaves outcome 'ok' — which is exactly the A2A
// shape seen live on 2026-09-09, when the SE cluster answered every specialist
// dispatch with 401 invalid_aud and UC2/UC2.5/UC37 still went green.

const PERMIT_ENTRY = {
  useCaseId: 'a2a-delegation',
  id: 'UC2',
  title: 'A2A delegation',
  expectedOutcome: 'PERMIT',
  evidence: { tokenChain: ['user-token', 'tool-dispatched'], activity: ['token', 'mcp'] },
};

const DENY_ENTRY = {
  useCaseId: 'authz-denied',
  id: 'UC6',
  title: 'Authz denied',
  expectedOutcome: 'DENY',
  evidence: { tokenChain: ['user-token', 'tool-dispatched'], activity: ['token', 'mcp'] },
};

const traceWith = (mcpResult, { outcome = 'ok', authorize = null } = {}) => ({
  outcome,
  authorize,
  tokenEvents: [{ id: 'user-token' }],
  mcpResult,
});

test('a PERMIT use case whose dispatch errored is NOT verified, even on a 200', () => {
  const v = computeVerdict(
    traceWith({ tool: 'get_portfolio_summary', status: 'error', error: 'invalid_aud', denied: false }),
    PERMIT_ENTRY,
  );
  expect(v.state).toBe('mismatch');
  expect(v.resultText).toBe('Run failed — the tool call did not complete');
});

test('a clean dispatch still verifies', () => {
  const v = computeVerdict(
    traceWith({ tool: 'get_portfolio_summary', status: 'success' }),
    PERMIT_ENTRY,
  );
  expect(v.state).toBe('verified');
});

// The carve-out that made the original outcome-only demotion safe must survive:
// a gateway policy DENY also arrives as status 'error', and for a deny-like use
// case that block IS the demo working.
test('a deny-like use case still reads denied-as-expected on an errored dispatch', () => {
  const v = computeVerdict(
    traceWith(
      { tool: 'create_transfer', status: 'error', error: 'gateway_policy_denied', denied: true },
      { outcome: 'error', authorize: { decision: 'DENY' } },
    ),
    DENY_ENTRY,
  );
  expect(v.state).toBe('denied-as-expected');
});
