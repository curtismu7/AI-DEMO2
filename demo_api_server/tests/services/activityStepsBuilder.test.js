'use strict';

const { buildActivitySteps } = require('../../services/activityStepsBuilder');

const kinds = (steps) => steps.map((s) => s.kind);

describe('buildActivitySteps', () => {
  it('always leads with identity + delegation', () => {
    const { steps } = buildActivitySteps({ success: true, toolsCalled: [] });
    expect(steps.slice(0, 2).map((s) => s.kind)).toEqual(['identity', 'delegation']);
  });

  it('PERMIT + tool + answer for a successful tool call (finalStatus done)', () => {
    const { steps, finalStatus } = buildActivitySteps({ success: true, toolsCalled: ['view_coverage'] });
    expect(kinds(steps)).toEqual(['identity', 'delegation', 'authorize', 'tool', 'answer']);
    expect(finalStatus).toBe('done');
    const authz = steps.find((s) => s.kind === 'authorize');
    expect(authz.data.decision).toBe('PERMIT');
    expect(authz.status).toBe('done');
    const tool = steps.find((s) => s.kind === 'tool');
    expect(tool.data).toEqual({ id: 'view_coverage', name: 'view_coverage', status: 'done' });
  });

  it('DENY produces a failed authorize step, no tool/answer, finalStatus failed', () => {
    const { steps, finalStatus } = buildActivitySteps({ success: false, error: 'mcp_authorization_denied', toolsCalled: [] });
    expect(kinds(steps)).toEqual(['identity', 'delegation', 'authorize']);
    expect(finalStatus).toBe('failed');
    const authz = steps.find((s) => s.kind === 'authorize');
    expect(authz.data.decision).toBe('DENY');
    expect(authz.status).toBe('failed');
  });

  it('step-up attaches a step_up obligation on a permit and suspends (finalStatus null)', () => {
    const { steps, finalStatus } = buildActivitySteps({ success: false, error: 'step_up_required', requiresStepUp: true, toolsCalled: [] });
    const authz = steps.find((s) => s.kind === 'authorize');
    expect(authz.data.decision).toBe('PERMIT');
    expect(authz.data.obligations[0].type).toBe('step_up_required');
    expect(steps.some((s) => s.kind === 'error')).toBe(false);
    expect(finalStatus).toBeNull();
  });

  it('hitl/consent attaches a consent obligation and suspends (finalStatus null)', () => {
    const { steps, finalStatus } = buildActivitySteps({ success: false, error: 'hitl_required', requiresConsent: true, toolsCalled: ['release_records'] });
    const authz = steps.find((s) => s.kind === 'authorize');
    expect(authz.data.obligations[0].type).toBe('hitl_consent_required');
    expect(finalStatus).toBeNull();
  });

  it('a non-authorization failure appends an error step (finalStatus failed)', () => {
    const { steps, finalStatus } = buildActivitySteps({ success: false, error: 'mcp_tool_failed', toolsCalled: ['view_coverage'] });
    expect(steps.some((s) => s.kind === 'error')).toBe(true);
    expect(steps.some((s) => s.kind === 'answer')).toBe(false);
    expect(finalStatus).toBe('failed');
  });

  it('multiple tools preserve order between authorize and answer', () => {
    const { steps } = buildActivitySteps({ success: true, toolsCalled: ['a', 'b'] });
    expect(kinds(steps)).toEqual(['identity', 'delegation', 'authorize', 'tool', 'tool', 'answer']);
  });

  it('uses decisionId in the authorize key when provided', () => {
    const { steps } = buildActivitySteps({ success: true, toolsCalled: ['x'], decisionId: 'dec-123' });
    expect(steps.find((s) => s.kind === 'authorize').key).toBe('authz:dec-123');
  });
});
