import { groupRequirementForUseCase } from '../requiredDemoFlags';

test('mirrors the server lever', () => {
  expect(groupRequirementForUseCase({ useCaseId: 'entitlement-tiered-capability', requiresGroup: 'in' })).toBe('in');
  expect(groupRequirementForUseCase({ useCaseId: 'group-entitlement-check', requiresGroup: 'out' })).toBe('out');
  expect(groupRequirementForUseCase({ useCaseId: 'delegated-access-with-proof' })).toBeNull();
  expect(groupRequirementForUseCase(null)).toBeNull();
  expect(groupRequirementForUseCase({ requiresGroup: 'sideways' })).toBeNull();
});
