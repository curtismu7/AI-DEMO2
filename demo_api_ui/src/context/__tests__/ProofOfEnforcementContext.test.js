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

// Regression: every rendered ProofStrip used to read either the live `verdict`
// or a positional slot in an append-only history that got one entry per store
// EMIT, not per run. A second run therefore repainted the first run's strip
// with its own result (a green UC1 strip turned yellow when UC14 ran next).
// verdictFor(runId) must keep each run's verdict pinned to that run.
test('a later run does not repaint an earlier run\'s verdict', async () => {
  const captured = { first: null, second: null };
  function RunProbe() {
    const { verdictFor } = useProofOfEnforcement();
    const one = verdictFor(captured.first);
    const two = verdictFor(captured.second);
    return (
      <div>
        <div data-testid="run1">{one ? `${one.useCaseId}:${one.state}` : 'none'}</div>
        <div data-testid="run2">{two ? `${two.useCaseId}:${two.state}` : 'none'}</div>
      </div>
    );
  }

  const { getByTestId } = render(
    <ProofOfEnforcementProvider vertical="banking">
      <RunProbe />
    </ProofOfEnforcementProvider>,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());

  act(() => {
    tokenChainTraceStore.beginTrace({ prompt: 'show my balance' });
    captured.first = tokenChainTraceStore.getState().trace.runId;
    tokenChainTraceStore.ingestTokenEvents([
      { id: 'user-token', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-exchange1', exchangeStep: '1-exchange', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
    ]);
    tokenChainTraceStore.ingestAuthorize({ decisionId: 'r1', decision: 'PERMIT', useCaseId: 'delegated-access-with-proof', vertical: 'banking' });
    tokenChainTraceStore.ingestMcpResult({ toolName: 'get_account_balance', status: 'success' });
  });
  await waitFor(() => expect(getByTestId('run1').textContent).toBe('delegated-access-with-proof:verified'));

  // Second run reaches no authorize decision — the shape that renders
  // "Incomplete — Waiting on authorize-decision".
  act(() => {
    tokenChainTraceStore.beginTrace({ prompt: 'attack sim: rar-exceeded' });
    captured.second = tokenChainTraceStore.getState().trace.runId;
    tokenChainTraceStore.ingestTokenEvents([
      { id: 'user-token', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
      { id: 'two-ex-exchange1', exchangeStep: '1-exchange', useCaseId: 'delegated-access-with-proof', vertical: 'banking' },
    ]);
  });
  await waitFor(() => expect(getByTestId('run2').textContent).toBe('delegated-access-with-proof:incomplete'));
  expect(captured.second).not.toBe(captured.first);
  expect(getByTestId('run1').textContent).toBe('delegated-access-with-proof:verified');
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

// Regression: a run that ENDED in failure read identically to one still in
// flight — "Waiting on authorize-decision" — because the verdict ignored
// trace.outcome, which completeTrace(false) already sets. During the gateway
// mTLS scheme break, PingOne Authorize returned PERMIT and the tool call died
// downstream; the strip still said the run was waiting on the decision.
describe('a failed run is not reported as still waiting', () => {
  const ENTRY = {
    useCaseId: 'delegated-access-with-proof',
    title: 'Delegated access with proof',
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'authorize-decision', 'tool-dispatched'], activity: ['token'] },
  };
  const partial = (outcome) => ({
    tokenEvents: [{ id: 'user-token' }],
    authorize: null,
    mcpResult: null,
    outcome,
  });

  test('still in flight keeps the waiting wording', () => {
    const v = computeVerdict(partial(null), ENTRY);
    expect(v.state).toBe('incomplete');
    expect(v.resultText).toBe('Waiting on authorize-decision, tool-dispatched');
  });

  test('an ended-in-error run says it failed, and names where it stopped', () => {
    const v = computeVerdict(partial('error'), ENTRY);
    expect(v.state).toBe('incomplete');
    expect(v.resultText).toBe('Run failed before authorize-decision, tool-dispatched');
    expect(v.missingSteps).toEqual(['authorize-decision', 'tool-dispatched']);
  });
});

// Regression: gateway-authoritative runs (useGateway: true) never populate
// trace.authorize — the BFF skips its own Authorize gate and PingOne's real
// PERMIT only ever arrives as a 'gw-authorize' token event. Without a
// fallback, a run the gateway actually permitted still read "Run failed
// before authorize-decision" because computeVerdict only checked trace.authorize.
describe('a gateway-authoritative PERMIT is not reported as incomplete', () => {
  const ENTRY = {
    useCaseId: 'delegated-access-with-proof',
    title: 'Delegated access with proof',
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'authorize-decision', 'tool-dispatched'], activity: ['token'] },
  };

  test('gw-authorize token event fills the authorize-decision step', () => {
    const v = computeVerdict({
      tokenEvents: [{ id: 'user-token' }, { id: 'gw-authorize', decision: 'PERMIT' }],
      authorize: null,
      mcpResult: { tool: 'view_coverage' },
      outcome: 'ok',
    }, ENTRY);
    expect(v.state).toBe('verified');
    expect(v.missingSteps).toEqual([]);
  });
});

// Regression: a deny-like expectation used to be satisfied by ANY non-PERMIT
// decision. mcpToolPipeline collapses step-up and HITL to 'INDETERMINATE', so a
// use case advertising a hard DENY rendered "Verified (denied as expected)" when
// the engine had actually returned PERMIT + a HITL approval obligation.
// trace.authorize.outcome now names the block kind; the verdict must honour it.
describe('deny-like verdicts discriminate block kind', () => {
  const entry = (expectedOutcome) => ({
    useCaseId: 'authz-denied', title: 'Authz denied', expectedOutcome,
    evidence: { tokenChain: ['authorize-decision'], activity: ['authorize'] },
  });
  const trace = (outcome) => ({
    tokenEvents: [], mcpResult: null,
    authorize: { decision: 'INDETERMINATE', outcome },
  });

  test('DENY expected but a HITL gate fired is a mismatch', () => {
    expect(computeVerdict(trace('HITL_REQUIRED'), entry('DENY')).state).toBe('mismatch');
  });

  test('DENY expected and DENY fired is denied-as-expected', () => {
    expect(computeVerdict(trace('DENY'), entry('DENY')).state).toBe('denied-as-expected');
  });

  test('HITL_REQUIRED expected and HITL fired stays green', () => {
    expect(computeVerdict(trace('HITL_REQUIRED'), entry('HITL_REQUIRED')).state).toBe('denied-as-expected');
  });

  test('HITL_REQUIRED expected stays green after approve→retry PERMIT keeps outcome', () => {
    // tokenChainTraceStore preserves outcome across the retry PERMIT ingest.
    const t = {
      tokenEvents: [],
      mcpResult: { tool: 'pay_bill' },
      authorize: { decision: 'PERMIT', outcome: 'HITL_REQUIRED', priorGate: 'HITL_REQUIRED' },
    };
    expect(computeVerdict(t, entry('HITL_REQUIRED')).state).toBe('denied-as-expected');
  });

  test('STEP_UP expected and step-up fired stays green', () => {
    expect(computeVerdict(trace('STEP_UP'), entry('STEP_UP')).state).toBe('denied-as-expected');
  });

  test('STEP_UP expected but DENY fired is a mismatch', () => {
    expect(computeVerdict(trace('DENY'), entry('STEP_UP')).state).toBe('mismatch');
  });

  test('no outcome reported falls back to the PERMIT/non-PERMIT check', () => {
    const t = { tokenEvents: [], mcpResult: null, authorize: { decision: 'DENY' } };
    expect(computeVerdict(t, entry('DENY')).state).toBe('denied-as-expected');
  });

  // Regression: declining the step-up still rendered "Step-up MFA required as
  // expected — then permitted". Nothing was permitted — the human refused the
  // gate — but the trace had no way to say so, so the string asserted a permit
  // that never happened.
  test('a declined step-up gate stays green but does not claim a permit', () => {
    const t = { ...trace('STEP_UP'), approvalOutcome: 'declined' };
    const v = computeVerdict(t, entry('STEP_UP'));
    expect(v.state).toBe('denied-as-expected');
    expect(v.resultText).not.toMatch(/then permitted/);
    expect(v.resultText).toMatch(/you declined/i);
  });

  test('a declined HITL gate stays green but does not claim a permit', () => {
    const t = { ...trace('HITL_REQUIRED'), approvalOutcome: 'declined' };
    const v = computeVerdict(t, entry('HITL_REQUIRED'));
    expect(v.state).toBe('denied-as-expected');
    expect(v.resultText).not.toMatch(/then permitted/);
    expect(v.resultText).toMatch(/you declined/i);
  });

  test('an approved step-up gate still reports the permit', () => {
    expect(computeVerdict(trace('STEP_UP'), entry('STEP_UP')).resultText).toMatch(
      /then permitted/,
    );
  });
});

// Regression: UC31 (weather-mcp-texas-deny) runs via the chip/agent path, which
// dispatches a tool (mcpResult set) and never emits the attack-sim-only
// 'sim-gateway-deny' event. Its catalog evidence listing 'sim-gateway-deny' made
// computeVerdict short-circuit to 'incomplete' on every correct deny. Matching the
// permit twin UC30's 'tool-dispatched' evidence (satisfied by trace.mcpResult)
// flips it to the green 'denied-as-expected' verdict.
describe('UC31 weather out-of-scope deny (chip path) reaches a verdict', () => {
  const UC31 = {
    useCaseId: 'weather-mcp-texas-deny',
    title: 'Third-party MCP server — out-of-scope call denied',
    expectedOutcome: 'DENY',
    evidence: { tokenChain: ['user-token', 'tool-dispatched'], activity: ['token', 'mcp'] },
  };
  const denyTrace = {
    tokenEvents: [{ id: 'user-token' }],
    authorize: null,
    mcpResult: { tool: 'get_weather', denied: true, expected: true, result: { error: 'weather_scope_denied' } },
  };

  test('the fixed tool-dispatched evidence verdicts as denied-as-expected', () => {
    const v = computeVerdict(denyTrace, UC31);
    expect(v.missingSteps).toEqual([]);
    expect(v.state).toBe('denied-as-expected');
  });

  test('the old sim-gateway-deny evidence is what made it incomplete', () => {
    const v = computeVerdict(denyTrace, {
      ...UC31,
      evidence: { tokenChain: ['user-token', 'sim-gateway-deny'], activity: ['token', 'mcp'] },
    });
    expect(v.state).toBe('incomplete');
    expect(v.missingSteps).toEqual(['sim-gateway-deny']);
  });
});
