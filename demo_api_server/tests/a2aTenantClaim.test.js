'use strict';

const {
  A2A_TENANT_CLAIM,
  resolveA2aTenantId,
  tenantHandle,
  tenantMatches,
} = require('../services/a2aTenantService');

describe('A2A tenant claim contract', () => {
  test('accepts only a non-empty string tenant claim', () => {
    expect(resolveA2aTenantId({ [A2A_TENANT_CLAIM]: 'org-demo' })).toBe('org-demo');
    expect(resolveA2aTenantId({ [A2A_TENANT_CLAIM]: '  org-demo  ' })).toBe('org-demo');
    expect(resolveA2aTenantId({})).toBeNull();
    expect(resolveA2aTenantId({ [A2A_TENANT_CLAIM]: 42 })).toBeNull();
    expect(resolveA2aTenantId({ [A2A_TENANT_CLAIM]: '   ' })).toBeNull();
  });

  test('creates a stable opaque handle without exposing the tenant id', () => {
    const handle = tenantHandle('org-demo');
    expect(handle).toMatch(/^t_[A-Za-z0-9_-]{22}$/);
    expect(handle).not.toContain('org-demo');
    expect(tenantHandle('org-demo')).toBe(handle);
    expect(tenantMatches(handle, handle)).toBe(true);
    expect(tenantMatches(handle, tenantHandle('other-org'))).toBe(false);
  });
});
