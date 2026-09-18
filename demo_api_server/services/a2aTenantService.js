'use strict';

const crypto = require('node:crypto');

const A2A_TENANT_USER_ATTRIBUTE = 'a2aTenantId';
const A2A_TENANT_CLAIM = 'a2a_tenant_id';

function resolveA2aTenantId(claims) {
  const value = claims && claims[A2A_TENANT_CLAIM];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function tenantHandle(tenantId) {
  if (typeof tenantId !== 'string' || !tenantId.trim()) return null;
  return `t_${crypto.createHash('sha256').update(tenantId.trim()).digest('base64url').slice(0, 22)}`;
}

function tenantMatches(expectedHandle, requestHandle) {
  return typeof expectedHandle === 'string' && expectedHandle.length > 0 && expectedHandle === requestHandle;
}

module.exports = {
  A2A_TENANT_USER_ATTRIBUTE,
  A2A_TENANT_CLAIM,
  resolveA2aTenantId,
  tenantHandle,
  tenantMatches,
};
