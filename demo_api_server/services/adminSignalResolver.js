'use strict';

const configStore = require('./configStore');
const { getRoleFromClaims } = require('./roleClaimResolver');

/**
 * Does this end-user sign-in earn the admin role? Four signals, any one is sufficient:
 *  1. admin_username allowlist  - permanent override (demoAdmin, service accounts)
 *  2. PingOne population ID     - admin users live in a dedicated PingOne population
 *  3. custom claim              - attribute named by admin_role_claim matches admin_role
 *  4. roleClaimResolver         - oauth_role_claim_* config (any IDP)
 * An existing store role is deliberately NOT consulted: role must be earned from IdP signals each login.
 * Shared by the end-user OAuth callback and the CIBA login so the two can never disagree.
 */
function resolveEndUserAdminSignals(mergedUserInfo, username) {
  const configuredAdminRole       = configStore.getEffective('admin_role') || 'admin';
  const configuredAdminUsernames  = (configStore.getEffective('admin_username') || '')
    .split(',').map(u => u.trim()).filter(Boolean);
  const configuredAdminPopulation = (configStore.getEffective('admin_population_id') || '').trim();
  const configuredRoleClaim       = (configStore.getEffective('admin_role_claim') || '').trim();

  // Signal 1: username allowlist - always wins, no PingOne attribute needed
  const usernameIsAdmin = configuredAdminUsernames.includes(username);

  // Signal 2: population - PingOne includes population.id in userinfo when mapped;
  // also check top-level populationId as some app configs surface it there.
  let populationIsAdmin = false;
  if (configuredAdminPopulation && !usernameIsAdmin) {
    const popId = mergedUserInfo?.population?.id || mergedUserInfo?.populationId || null;
    populationIsAdmin = popId === configuredAdminPopulation;
  }

  // Signal 3: custom claim - supports string or array (e.g. group membership list)
  let claimIsAdmin = false;
  if (configuredRoleClaim && !usernameIsAdmin && !populationIsAdmin) {
    const claimValue = mergedUserInfo[configuredRoleClaim];
    claimIsAdmin = Array.isArray(claimValue)
      ? claimValue.includes(configuredAdminRole)
      : claimValue === configuredAdminRole;
  }

  // Signal 5: roleClaimResolver
  const resolverIsAdmin = getRoleFromClaims(mergedUserInfo) === 'admin';

  return {
    isAdmin: usernameIsAdmin || populationIsAdmin || claimIsAdmin || resolverIsAdmin,
    usernameIsAdmin, populationIsAdmin, claimIsAdmin, resolverIsAdmin, configuredRoleClaim,
  };
}

module.exports = { resolveEndUserAdminSignals };
