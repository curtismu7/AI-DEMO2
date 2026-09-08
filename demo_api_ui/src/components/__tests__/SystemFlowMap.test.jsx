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

  it('counts only hops that actually ran', () => {
    const { lit } = buildFlowModel([
      step('prompt', 'done'),
      step('exchange', 'done'),
      step('stepup', 'notinpath'),
    ]);
    expect(lit).toBe(2);
  });

  it('paints a repeated authorize evaluation on the same edge via baseId', () => {
    const second = { ...authorizeStep('PERMIT'), id: 'authorize-2', baseId: 'authorize' };
    const { edges } = buildFlowModel([second]);
    expect(edges[0]).toMatchObject({ from: 'pep', to: 'p1-authorize' });
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
});
