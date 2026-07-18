import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { ProofOfEnforcementProvider, useProofOfEnforcement, computeVerdict } from '../ProofOfEnforcementContext';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

const CATALOG = [
  {
    useCaseId: 'delegated-access-with-proof',
    title: 'Delegated access with proof',
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
  },
  {
    useCaseId: 'authz-denied',
    title: 'Authz denied',
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
  },
  {
    useCaseId: 'attack-blocked-403',
    title: 'Attack blocked (403)',
    expectedOutcome: 'DENY_403',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
  },
  {
    useCaseId: 'hitl-consent',
    title: 'HITL consent required',
    expectedOutcome: 'HITL_REQUIRED',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
  },
  {
    useCaseId: 'ranked-results-demo',
    title: 'Ranked results demo',
    expectedOutcome: 'RANKED_RESULTS',
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'mcp'] },
  },
];

function Probe() {
  const { verdict } = useProofOfEnforcement();
  return (
    <div>
      <div data-testid="verdict">{verdict ? `${verdict.useCaseId}:${verdict.state}` : 'none'}</div>
      <div data-testid="vertical">{verdict ? verdict.vertical : ''}</div>
    </div>
  );
}

beforeEach(() => {
  tokenChainTraceStore.reset();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ useCases: CATALOG }) }));
});

test('a fully-matched PERMIT trace verdicts as verified', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestTokenEvents([
      { id: 'user-token', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-exchange1', exchangeStep: '1-exchange', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
    ]);
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd1', decision: 'PERMIT', useCaseId: 'delegated-access-with-proof', vertical: 'banking' });
    tokenChainTraceStore.ingestMcpResult({ toolName: 'get_balance', status: 'success' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('delegated-access-with-proof:verified'));
  expect(getByTestId('vertical').textContent).toBe('banking');
});

test('a real RFC 8693 two-exchange trace (no literal "token-exchange" id) still matches the token-exchange evidence step', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    // Mirrors the real backend's two-exchange tokenEvents shape (live-captured
    // from /api/mcp/tool): none of these ids is literally 'token-exchange', but
    // several carry a structured exchangeStep field marking an actual exchange.
    tokenChainTraceStore.ingestTokenEvents([
      { id: 'user-token', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-agent-actor', exchangeStep: '1-actor', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-agent-actor-verified', exchangeStep: '1-actor', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-exchange1', exchangeStep: '1-exchange', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-exchange1-verified', exchangeStep: '1-exchange', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-mcp-actor', exchangeStep: '2-actor', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-final-token', exchangeStep: '2-exchange', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-final-token-verified', exchangeStep: '2-exchange', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
    ]);
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd1b', decision: 'PERMIT', useCaseId: 'delegated-access-with-proof', vertical: 'banking' });
    tokenChainTraceStore.ingestMcpResult({ toolName: 'get_my_accounts', status: 'success' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('delegated-access-with-proof:verified'));
});

test('a DENY outcome for an attack use case verdicts as denied-as-expected', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd2', decision: 'DENY', useCaseId: 'authz-denied' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('authz-denied:denied-as-expected'));
});

test('an outcome that contradicts expectedOutcome verdicts as mismatch', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd3', decision: 'PERMIT', useCaseId: 'authz-denied' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('authz-denied:mismatch'));
});

test('a DENY_403 block outcome (no decision field, real block shape) verdicts as denied-as-expected', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    // Mirrors the real backend DENY shape: decisionContext/decisionId are set,
    // but `decision` itself is never populated on the block body (see the
    // decisionOf() comment in ProofOfEnforcementContext.js).
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd4', decisionContext: 'McpFirstTool', useCaseId: 'attack-blocked-403' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('attack-blocked-403:denied-as-expected'));
});

test('a HITL_REQUIRED block outcome (no decision field) verdicts as denied-as-expected', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd5', decisionContext: 'McpFirstTool', useCaseId: 'hitl-consent' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('hitl-consent:denied-as-expected'));
});

test('a RANKED_RESULTS success outcome with a real PERMIT decision verdicts as verified, not mismatch', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    // The backend always emits 'PERMIT' as trace.authorize.decision for permits,
    // regardless of the catalog's specific non-PERMIT success-outcome label
    // (RANKED_RESULTS here). This must NOT read as a mismatch.
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd6', decision: 'PERMIT', useCaseId: 'ranked-results-demo' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('ranked-results-demo:verified'));
});

test('untagged events produce no verdict', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestTokenEvents([{ id: 'user-token' }]);
  });
  expect(getByTestId('verdict').textContent).toBe('none');
});

test('sticky a2a-delegation on session user-token does not hijack the next use case verdict', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    // Simulate prior UC2: user-token still carries a2a-delegation after beginTrace
    // carry-over (pre-fix). Call-scoped events + authorize belong to UC1.
    tokenChainTraceStore.ingestTokenEvents([
      { id: 'user-token', useCaseId: 'a2a-delegation', vertical: 'banking' },
      { id: 'two-ex-exchange1', exchangeStep: '1-exchange', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
    ]);
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'd-uc1', decision: 'PERMIT', useCaseId: 'delegated-access-with-proof', vertical: 'banking' });
    tokenChainTraceStore.ingestMcpResult({ toolName: 'get_balance', status: 'success' });
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('delegated-access-with-proof:verified'));
});

test('session-only sticky useCaseId yields no verdict until call-scoped evidence arrives', async () => {
  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <Probe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  act(() => {
    tokenChainTraceStore.ingestTokenEvents([
      { id: 'user-token', useCaseId: 'a2a-delegation', vertical: 'banking' },
    ]);
  });
  await waitFor(() => expect(getByTestId('verdict').textContent).toBe('none'));
});

// Regression: gateway-level attack sims (aud/scope denies) are blocked BEFORE
// PingOne Authorize runs, so they never produce an 'authorize-decision'. UC5/UC11/UC12
// used to declare it as required evidence, which made computeVerdict short-circuit to
// 'incomplete' on every run — even though the attack was correctly blocked with a 401.
// Event ids below are the ones attackSimulatorService.js actually emits.
describe('gateway-denied attack sims reach a verdict', () => {
  const UC12 = {
    useCaseId: 'token-theft-replay',
    title: 'Token theft / replay defense',
    expectedOutcome: 'DENY_401',
    evidence: { tokenChain: ['sim-replay-start', 'sim-gateway-deny'], activity: ['token', 'gateway'] },
  };

  const replayTrace = {
    tokenEvents: [{ id: 'sim-replay-start' }, { id: 'sim-gateway-deny' }],
    authorize: null,
    mcpResult: null,
  };

  test('UC12 replay sim is denied-as-expected, not incomplete', () => {
    const v = computeVerdict(replayTrace, UC12);
    expect(v.missingSteps).toEqual([]);
    expect(v.state).toBe('denied-as-expected');
  });

  test('the old contract is what made it incomplete', () => {
    const v = computeVerdict(replayTrace, {
      ...UC12,
      evidence: { tokenChain: ['user-token', 'authorize-decision'], activity: ['token', 'gateway'] },
    });
    expect(v.state).toBe('incomplete');
    expect(v.missingSteps).toEqual(['user-token', 'authorize-decision']);
  });
});
