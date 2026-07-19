import { describe, it, expect, beforeEach } from 'vitest';
import { tokenChainTraceStore } from '../tokenChainTraceStore';
import { buildSimRailEvents } from '../simTraceAdapter';
import { computeVerdict } from '../../../context/ProofOfEnforcementContext';

// Reproduces AIAgent's attack-sim handler: begin the trace, then feed the sim's
// real evidence into the rail store the way the handler does. Proves the whole
// UC13 loop — the rail lights the exchange + PingOne Authorize DENY steps AND
// the Proof verdict flips from "incomplete" to "denied-as-expected".

const UC13_ENTRY = {
  useCaseId: 'confused-deputy-actor-injection',
  title: 'Confused-deputy actor injection',
  expectedOutcome: 'DENY',
  evidence: { tokenChain: ['authorize-decision'], activity: ['authorize', 'gateway'] },
};

// Shape the backend now returns from runAttackSim('rogue-actor', …) on a real
// gateway → PingOne Authorize DENY.
function rogueActorResult() {
  return {
    sim: 'rogue-actor',
    useCaseId: 'confused-deputy-actor-injection',
    status: 403,
    errorCode: 'mcp_invalid_actor',
    reason: 'PingOne Authorize DENY — unauthorized actor in the delegation chain (HasValidActorChain)',
    tokenChainEvents: [
      { id: 'user-token', status: 'active', claims: { sub: 'user-1' } },
      { id: 'sim-exchange-ok', status: 'active', claims: { sub: 'user-1', aud: 'gw' } },
      { id: 'sim-rogue-actor', status: 'active' },
      { id: 'sim-gateway-deny', status: 'error', error: 'mcp_invalid_actor', httpStatus: 403 },
    ],
    authorize: {
      engine: 'PingOne Authorize',
      decision: 'DENY',
      outcome: 'DENY',
      decisionId: 'dec-123',
      decisionContext: 'McpToolCall',
      reason: null,
      useCaseId: 'confused-deputy-actor-injection',
      vertical: 'banking',
    },
  };
}

/** The exact wiring AIAgent's attack-sim handler performs after the POST. */
function feedRail(data) {
  tokenChainTraceStore.beginTrace({ prompt: 'Demo step 12: UC13 — Confused-deputy actor injection' });
  buildSimRailEvents(data).forEach((ev) => tokenChainTraceStore.ingestTokenEvent(ev));
  if (data.authorize) tokenChainTraceStore.ingestAuthorize(data.authorize);
  tokenChainTraceStore.completeTrace(typeof data.status === 'number' && data.status < 400);
}

describe('attack-sim → Token Chain rail integration (UC13)', () => {
  beforeEach(() => tokenChainTraceStore.reset());

  it('lights Sign-in, Token exchange, and PingOne Authorize DENY on the rail', () => {
    feedRail(rogueActorResult());
    const { steps } = tokenChainTraceStore.getState();
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));

    expect(byId.signin.status).toBe('done');       // user-token
    expect(byId.exchange.status).toBe('done');     // sim-exchange-ok → exchanged-token
    expect(byId.authorize.status).toBe('error');   // real DENY
    expect(byId.authorize.detail.decision.outcome).toBe('DENY');
  });

  it('flips the Proof verdict from incomplete to denied-as-expected', () => {
    // Before the fix: the sim never set trace.authorize, so the evidence
    // contract ['authorize-decision'] was unmet.
    const emptyTrace = { tokenEvents: [], phases: [] };
    expect(computeVerdict(emptyTrace, UC13_ENTRY).state).toBe('incomplete');

    feedRail(rogueActorResult());
    const { trace } = tokenChainTraceStore.getState();
    expect(computeVerdict(trace, UC13_ENTRY).state).toBe('denied-as-expected');
  });
});
