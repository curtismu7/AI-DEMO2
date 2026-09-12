// The pure model behind the system flow map: how a run's steps become node
// states and edges. These are the cases that would silently mislead a room —
// a gate painted as a failure, a denial painted on the caller, an unrun hop
// painted as reached.
import { describe, it, expect } from 'vitest';
import {
  buildFlowModel,
  stateForStep,
  verdictLabel,
  verdictTone,
  STEP_TO_EDGE,
  NODES,
  BANDS,
  sidesFor,
} from '../SystemFlowMap';

const step = (id, status, detail) => ({ id, status, title: id, detail: detail || {} });
const authorizeStep = (outcome) =>
  step('authorize', 'done', { decision: { outcome } });

describe('stateForStep', () => {
  it('leaves a hop with no evidence unlit rather than guessing', () => {
    expect(stateForStep(step('mcp', 'pending'), null)).toBe(null);
    expect(stateForStep(null, null)).toBe(null);
  });

  it('distinguishes "not yet" from "positively not in this path"', () => {
    expect(stateForStep(step('mcp', 'pending'), null)).toBe(null);
    expect(stateForStep(step('mcp', 'notinpath'), null)).toBe('skipped');
  });

  it('paints a gate as held, not as an error', () => {
    expect(stateForStep(authorizeStep('STEP_UP'), 'STEP_UP')).toBe('held');
    expect(stateForStep(authorizeStep('HITL_REQUIRED'), 'HITL_REQUIRED')).toBe('held');
  });

  it('paints an explicit DENY as an error even though the step itself is done', () => {
    expect(stateForStep(authorizeStep('DENY'), 'DENY')).toBe('error');
  });
});

describe('buildFlowModel', () => {
  it('survives a missing or empty step list', () => {
    expect(buildFlowModel(undefined)).toEqual({ nodeStates: {}, edges: [], decision: null, lit: 0 });
    expect(buildFlowModel([]).edges).toHaveLength(0);
  });

  it('lights the browser from the website step, which is an origin not a hop', () => {
    const { nodeStates, edges } = buildFlowModel([step('website', 'done')]);
    expect(nodeStates.browser).toBe('done');
    expect(edges).toHaveLength(0);
  });

  it('draws a hop between the two boxes its step names', () => {
    const { edges } = buildFlowModel([step('exchange', 'done')]);
    expect(edges).toEqual([
      expect.objectContaining({ from: 'bff', to: 'p1-exchange', kind: 'oauth', state: 'done' }),
    ]);
  });

  it('reddens a denied hop\'s target but never its caller', () => {
    const { nodeStates } = buildFlowModel([
      step('gateway', 'done'),
      authorizeStep('DENY'),
    ]);
    expect(nodeStates['p1-authorize']).toBe('error');
    // The PEP originated the PDP call — it is reached, not failed.
    expect(nodeStates.pep).toBe('done');
  });

  it('keeps the strongest state when several hops touch one box', () => {
    // The BFF sources six hops; a later clean one must not repaint an earlier
    // failure away.
    const { nodeStates } = buildFlowModel([
      step('prompt', 'error'),
      step('exchange', 'done'),
    ]);
    expect(nodeStates.bff).toBe('error');
  });

  it('excludes NOT_RECORDED, which is a display default and not a verdict', () => {
    expect(buildFlowModel([authorizeStep('NOT_RECORDED')]).decision).toBe(null);
    expect(buildFlowModel([authorizeStep('PERMIT')]).decision).toBe('PERMIT');
  });

  it('draws one lane per node pair, not one per step', () => {
    // Found by driving a live run: tools-list-challenge, tools-list and gateway
    // are all bff->pep, and one path each drew three coincident lines whose
    // visible colour was whichever rendered last.
    const { edges } = buildFlowModel([
      step('tools-list-challenge', 'done'),
      step('tools-list', 'done'),
      step('gateway', 'done'),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: 'bff', to: 'pep' });
    expect(edges[0].title).toBe('tools-list-challenge · tools-list · gateway');
  });

  it('gives a shared lane its strongest state, so a skipped hop cannot blank a real one', () => {
    const { edges } = buildFlowModel([
      step('tools-list', 'done'),
      step('gateway', 'notinpath'),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].state).toBe('done');
  });

  it('counts hops that ran, not lanes drawn', () => {
    // Collapsing three bff->pep steps into one line must not make the header
    // under-report the run.
    const { edges, lit } = buildFlowModel([
      step('tools-list-challenge', 'done'),
      step('tools-list', 'done'),
      step('gateway', 'done'),
    ]);
    expect(edges).toHaveLength(1);
    expect(lit).toBe(3);
  });

  it('counts only hops that actually ran', () => {
    const { lit } = buildFlowModel([
      step('prompt', 'done'),
      step('exchange', 'done'),
      step('stepup', 'notinpath'), // not in STEP_TO_EDGE — see deriveGateStates
    ]);
    expect(lit).toBe(2);
  });

  it('paints a repeated authorize evaluation on the same edge via baseId', () => {
    const second = { ...authorizeStep('PERMIT'), id: 'authorize-2', baseId: 'authorize' };
    const { edges } = buildFlowModel([second]);
    expect(edges[0]).toMatchObject({ from: 'pep', to: 'p1-authorize' });
  });

  it('repaints a stale "active" hop to done once the reply step proves the run ended', () => {
    // trace.outcome frequently never gets set on live runs (buildTraceSteps.js),
    // which used to leave a hop reading 'active' — and its box lit blue —
    // forever after the run had genuinely finished.
    const { nodeStates, edges } = buildFlowModel([
      step('gateway', 'active'),
      step('reply', 'done'),
    ]);
    expect(nodeStates.pep).toBe('done');
    expect(edges[0]).toMatchObject({ from: 'bff', to: 'pep', state: 'done' });
  });

  it('leaves a genuinely in-flight hop active while the reply has not arrived', () => {
    const { nodeStates } = buildFlowModel([step('gateway', 'active')]);
    expect(nodeStates.pep).toBe('active');
  });
});

describe('verdict', () => {
  it('reports the decision when Authorize returned one', () => {
    expect(verdictLabel('STEP_UP', { outcome: 'active' })).toBe('STEP UP');
    expect(verdictTone('STEP_UP', { outcome: 'active' })).toBe('held');
    expect(verdictTone('DENY', { outcome: 'ok' })).toBe('error');
  });

  it('falls back to the run story when there is no decision', () => {
    expect(verdictLabel(null, null)).toBe('IDLE');
    expect(verdictLabel(null, { outcome: 'ok' })).toBe('COMPLETE');
    expect(verdictLabel(null, { outcome: 'error' })).toBe('RUN ERROR');
    expect(verdictLabel(null, { outcome: 'active' })).toBe('RUNNING');
  });
});

describe('MFA / Consent / CIBA gate boxes', () => {
  it('lights MFA from routes/mfa.js phases, independent of consent/CIBA', () => {
    const trace = { phases: [{ phase: 'mfa_challenge_completed' }] };
    const { nodeStates } = buildFlowModel([], trace);
    expect(nodeStates['p1-mfa']).toBe('done');
    expect(nodeStates['p1-consent']).toBeUndefined();
    expect(nodeStates['p1-ciba']).toBeUndefined();
  });

  it('marks MFA active while only the challenge has started', () => {
    const trace = { phases: [{ phase: 'mfa_challenge_initiated' }] };
    const { nodeStates } = buildFlowModel([], trace);
    expect(nodeStates['p1-mfa']).toBe('active');
  });

  it('marks a failed MFA challenge as an error', () => {
    const trace = { phases: [{ phase: 'mfa_challenge_failed' }] };
    const { nodeStates } = buildFlowModel([], trace);
    expect(nodeStates['p1-mfa']).toBe('error');
  });

  it('lights Consent from the HITL/consent gate phases, active until hitlApproved', () => {
    const started = { phases: [{ phase: 'authorize_denied_hitl' }] };
    expect(buildFlowModel([], started).nodeStates['p1-consent']).toBe('active');

    const approved = { phases: [{ phase: 'gateway_hitl_required' }], authorize: { hitlApproved: true } };
    expect(buildFlowModel([], approved).nodeStates['p1-consent']).toBe('done');
  });

  it('lights CIBA from a ciba-poll token event, independent of MFA/consent', () => {
    const pending = { tokenEvents: [{ id: 'ciba-poll', additionalData: { status: 'pending' } }] };
    expect(buildFlowModel([], pending).nodeStates['p1-ciba']).toBe('active');

    const approved = { tokenEvents: [{ id: 'ciba-poll', additionalData: { status: 'approved' } }] };
    expect(buildFlowModel([], approved).nodeStates['p1-ciba']).toBe('done');
    expect(buildFlowModel([], approved).nodeStates['p1-mfa']).toBeUndefined();

    const denied = { tokenEvents: [{ id: 'ciba-poll', additionalData: { status: 'denied' } }] };
    expect(buildFlowModel([], denied).nodeStates['p1-ciba']).toBe('error');
  });

  it('marks all three skipped once the run has ended without any of them firing', () => {
    const trace = { phases: [{ phase: 'reply' }] }; // trace shape irrelevant — `ended` comes from steps
    const { nodeStates } = buildFlowModel([step('reply', 'done')], trace);
    expect(nodeStates['p1-mfa']).toBe('skipped');
    expect(nodeStates['p1-consent']).toBe('skipped');
    expect(nodeStates['p1-ciba']).toBe('skipped');
  });

  it('draws a pep hop for whichever gate box is lit', () => {
    const trace = { phases: [{ phase: 'mfa_challenge_completed' }] };
    const { edges } = buildFlowModel([], trace);
    expect(edges).toEqual([expect.objectContaining({ from: 'pep', to: 'p1-mfa', state: 'done' })]);
  });
});

describe('map wiring', () => {
  it('every edge names boxes that exist, so no hop can point off the map', () => {
    for (const [stepId, spec] of Object.entries(STEP_TO_EDGE)) {
      for (const nodeId of [spec.from, spec.to, spec.node].filter(Boolean)) {
        expect(NODES[nodeId], `${stepId} -> ${nodeId}`).toBeDefined();
      }
    }
  });

  it('every box is placed in exactly one band', () => {
    const placed = BANDS.flatMap((b) => b.nodes);
    expect([...placed].sort()).toEqual(Object.keys(NODES).sort());
  });

  it('runs a lane vertically between stacked bands and sideways within a row', () => {
    expect(sidesFor('bff', 'pep')).toEqual(['right', 'left']);
    expect(sidesFor('bff', 'browser')).toEqual(['left', 'right']);
    expect(sidesFor('bff', 'p1-exchange')).toEqual(['top', 'bottom']);
    expect(sidesFor('agent', 'llm')).toEqual(['bottom', 'top']);
  });
});
