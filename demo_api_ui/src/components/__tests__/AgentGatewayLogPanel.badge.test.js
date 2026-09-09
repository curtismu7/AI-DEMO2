import { describe, it, expect } from 'vitest';
import { decisionBadgeClass } from '../AgentGatewayLogPanel';

/**
 * The row badge used to be `denied = d.decision !== 'PERMIT'`, so an approval
 * gate took the red error badge. A gate is held, not refused.
 */
describe('decisionBadgeClass', () => {
  it('PERMIT is live', () => {
    expect(decisionBadgeClass({ decision: 'PERMIT' })).toBe('mgc-badge--live');
  });

  it('a real DENY is an error', () => {
    expect(decisionBadgeClass({ decision: 'DENY' })).toBe('mgc-badge--error');
  });

  it.each(['INDETERMINATE', 'STEP_UP', 'HITL_REQUIRED'])('%s is held, not an error', (decision) => {
    expect(decisionBadgeClass({ decision })).toBe('mgc-badge--warn');
  });

  it('reads an obligation-carried pause too, not just the legacy decision values', () => {
    expect(decisionBadgeClass({ decision: 'PERMIT', obligations: [{ type: 'HITL_CONSENT' }] }))
      .toBe('mgc-badge--warn');
  });

  it('a missing decision is an error, never silently live', () => {
    expect(decisionBadgeClass({})).toBe('mgc-badge--error');
  });
});
