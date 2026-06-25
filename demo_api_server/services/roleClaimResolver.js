'use strict';
const configStore = require('./configStore');

/**
 * Resolves admin/customer role from token claims based on oauth_role_claim_* config.
 *
 * Supports:
 * - String claims: population_id = 'admin-uuid' → 'admin'
 * - Array claims: app_roles = ['admin', 'user'] → 'admin' (azure AD, Auth0)
 * - URI suffix matching: roles = ['https://example.com/roles/admin'] → matches 'admin'
 *
 * Returns 'admin', 'customer', or null.
 * null means the new role claim config has no opinion (caller should fall back
 * to legacy admin_population_id / admin_role_claim signals).
 */
function getRoleFromClaims(claims) {
  if (!claims || typeof claims !== 'object') return null;

  const claimName    = configStore.getEffective('oauth_role_claim_name')           || 'population_id';
  const adminValue   = (configStore.getEffective('oauth_role_claim_value_admin')   || '').trim();
  const customerValue= (configStore.getEffective('oauth_role_claim_value_customer')|| '').trim();
  const isArray      = ['true', '1', true].includes(configStore.getEffective('oauth_role_claim_is_array'));

  // If neither admin nor customer value is configured, we have no opinion
  if (!adminValue && !customerValue) return null;

  const claimValue = claims[claimName];
  if (claimValue === undefined || claimValue === null || claimValue === '') return null;

  if (isArray) {
    const roles = Array.isArray(claimValue) ? claimValue : [claimValue];
    for (const r of roles) {
      if (adminValue && (r === adminValue || (typeof r === 'string' && r.endsWith('/' + adminValue)))) return 'admin';
    }
    for (const r of roles) {
      if (customerValue && (r === customerValue || (typeof r === 'string' && r.endsWith('/' + customerValue)))) return 'customer';
    }
    return null;
  } else {
    const v = String(claimValue);
    if (adminValue    && v === adminValue)    return 'admin';
    if (customerValue && v === customerValue) return 'customer';
    return null;
  }
}

module.exports = { getRoleFromClaims };
