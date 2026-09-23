import { describe, expect, it } from 'vitest';
import {
  MISSION_CONTROL_CATALOG,
  getMissionControlGroup,
} from '../missionControlCatalog';

describe('missionControlCatalog', () => {
  it('defines the 12 presenter groups with product ownership', () => {
    expect(MISSION_CONTROL_CATALOG).toHaveLength(12);
    expect(MISSION_CONTROL_CATALOG.map((group) => group.id)).toEqual([
      'personal-agent',
      'digital-assistant',
      'consumer-partner',
      'employee-agent',
      'workload-agent',
      'agent-network',
      'discover',
      'register',
      'authenticate',
      'authorize',
      'privilege',
      'govern',
    ]);
    expect(MISSION_CONTROL_CATALOG.every((group) => group.product)).toBe(true);
  });

  it('reuses existing inspectors and diagrams for Personal Agent', () => {
    const group = getMissionControlGroup('personal-agent');
    expect(group.inspectors).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: '/agent-registry' }),
      expect.objectContaining({ href: '/agent-flow-inspector' }),
    ]));
    expect(group.diagrams).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: '/agent-onboarding-flow' }),
      expect.objectContaining({ href: '/architecture/token-chain' }),
    ]));
  });

  it('keeps the employee lane planned', () => {
    expect(getMissionControlGroup('employee-agent')).toMatchObject({ status: 'planned' });
    expect(getMissionControlGroup('saas-embedded-agent')).toBeUndefined();
  });
});
