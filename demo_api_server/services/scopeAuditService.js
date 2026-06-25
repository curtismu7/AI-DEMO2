const configStore = require('./configStore');
const axios = require('axios');
const scopeTopology = require('./scopeTopology');
const { getManagementToken } = require('./pingOneClientService');

/**
 * Build the scope audit reference table lazily so that a topology load failure
 * only affects callers of auditResourceScopes, not every module that requires
 * this file (WR-07).
 *
 * Keys are the ACTUAL PingOne resource server display names (as seen in the
 * Management API response and in docs/PINGONE_CONFIG.md): scope-topology.json
 * uses internal "Super Banking *" names; its provisioning.resourceNames block
 * maps those to the "Demo *" names used in PingOne.
 */
function buildScopeReferenceTable() {
  const table = {};
  try {
    for (const topologyName of scopeTopology.allResources()) {
      table[scopeTopology.provisionedResourceName(topologyName)] =
        scopeTopology.resourceScopes(topologyName);
    }
  } catch (e) {
    console.warn('[scopeAudit] Could not build scope reference table from topology: %s', e.message);
  }
  return table;
}

// Built lazily on first audit call so a topology load failure doesn't crash the
// module at require time. Exported for test inspection only.
let _scopeReferenceTableCache = null;
function getScopeReferenceTable() {
  if (!_scopeReferenceTableCache) {
    _scopeReferenceTableCache = buildScopeReferenceTable();
  }
  return _scopeReferenceTableCache;
}

/**
 * Compare current scopes against expected (order-independent set comparison).
 */
function compareScopes(current, expected) {
  const currentSet  = new Set(current  || []);
  const expectedSet = new Set(expected || []);

  const missing = [...expectedSet].filter((s) => !currentSet.has(s));
  const extra   = [...currentSet].filter((s)  => !expectedSet.has(s));

  // CR-04: removed unreachable NEEDS_REVIEW branch — after filtering missing
  // and extra, the only remaining case is both empty, which means CORRECT.
  if (missing.length === 0 && extra.length === 0) {
    return { status: 'CORRECT', mismatches: null };
  }

  return {
    status: 'MISMATCH',
    mismatches: {
      missing: missing.length > 0 ? missing : undefined,
      extra:   extra.length   > 0 ? extra   : undefined,
    },
  };
}

/**
 * Audit resource scopes:
 * - Fetches current scopes from PingOne for each validated resource
 * - Compares against expected values from SCOPE_REFERENCE_TABLE
 * - Returns CORRECT | MISMATCH | NEEDS_REVIEW status per resource
 *
 * @param {Array} validatedResources - output from resourceValidationService.validateResources()
 */
async function auditResourceScopes(validatedResources) {
  const envId  = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';

  // Build (or retrieve cached) reference table at call time, not at require
  // time, so topology failures don't crash module load (WR-07).
  const refTable = getScopeReferenceTable();

  try {
    const token   = await getManagementToken();
    const apiBase = `https://api.pingone.${region}/v1/environments/${envId}`;

    const results = await Promise.all(
      validatedResources
        .filter((res) => res.status !== 'MISSING')
        .map(async (res) => {
          try {
            const { data: scopesData } = await axios.get(
              `${apiBase}/resource-servers/${res.resourceId}/scopes`,
              { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
            );

            const scopeList      = (scopesData.scopes || []).map((s) => s.name);
            const expectedScopes = refTable[res.name] || [];
            const scopeResult    = compareScopes(scopeList, expectedScopes);

            return {
              resourceId:    res.resourceId,
              name:          res.name,
              audience:      res.audience,
              currentScopes: scopeList,
              expectedScopes,
              status:        scopeResult.status,
              mismatches:    scopeResult.mismatches,
            };
          } catch (error) {
            // WR-08: warn, not error — a 404/401 from PingOne is recoverable
            console.warn(`[scopeAudit] Could not audit scopes for "${res.name}": ${error.message}`);
            return {
              resourceId:    res.resourceId,
              name:          res.name,
              audience:      res.audience,
              currentScopes: [],
              expectedScopes: refTable[res.name] || [],
              status:        'ERROR',
              error:         error.message,
            };
          }
        })
    );

    return {
      status:     'success',
      auditedAt:  new Date().toISOString(),
      scopeAudit: results,
    };
  } catch (error) {
    console.warn('[scopeAudit] Scope audit failed: %s', error.message);
    return {
      status:     'error',
      error:      error.message,
      auditedAt:  new Date().toISOString(),
      scopeAudit: [],
    };
  }
}

module.exports = {
  auditResourceScopes,
  // Tests and external callers that need to inspect the table can use either
  // the getter or the lazily-evaluated property alias below.
  getScopeReferenceTable,
  // Back-compat alias — returns the built table (triggers lazy build on access).
  get SCOPE_REFERENCE_TABLE() { return getScopeReferenceTable(); },
};
