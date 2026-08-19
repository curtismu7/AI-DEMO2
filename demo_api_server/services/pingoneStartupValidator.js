'use strict';

/**
 * pingoneStartupValidator.js
 *
 * PingOne configuration check that runs once at server start whenever management
 * worker credentials are present (no opt-in flag required). Auto-creates any
 * scopes that are missing from the resource servers.
 *
 * The check is fully non-blocking — it never delays startup or rejects requests.
 * On failure it logs warnings to stdout; on success it logs a single ✅ line.
 *
 * What is checked / fixed:
 *   1. Resource servers — all four Demo resource servers exist in PingOne with
 *      the correct audience value (enduser.ping.demo, agentgateway.ping.demo,
 *      mcpgateway.ping.demo, mcpserver.ping.demo).
 *   2. Resource scopes — each resource has the expected set of scopes; missing
 *      scopes are automatically created. Extra scopes are logged only (never deleted).
 *
 * The check is skipped (silently) when:
 *   - Management worker credentials are not configured
 *   - PingOne is unreachable (network error)
 *
 * Opt-out: set PINGONE_VALIDATE_ON_STARTUP=false to disable entirely.
 *
 * See docs/PINGONE_CONFIG.md for the authoritative list of expected values.
 */

const axios = require('axios');
const configStore = require('./configStore');
const { getManagementToken } = require('./pingOneClientService');
const { validateResources } = require('./resourceValidationService');
const { auditResourceScopes } = require('./scopeAuditService');

const TAG = '[pingone-startup]';

/**
 * Create a missing scope on a PingOne resource server.
 * @param {string} resourceId
 * @param {string} scopeName
 * @param {string} apiBase  e.g. https://api.pingone.com/v1/environments/<id>
 * @param {string} token    Management bearer token
 * @returns {Promise<{ ok: boolean, scopeName: string, error?: string }>}
 */
async function _createScope(resourceId, scopeName, apiBase, token) {
  try {
    await axios.post(
      apiBase + '/resource-servers/' + resourceId + '/scopes',
      { name: scopeName, description: 'Scope: ' + scopeName },
      { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    return { ok: true, scopeName: scopeName };
  } catch (err) {
    // 409 Conflict = scope already exists — treat as success
    if (err.response && err.response.status === 409) {
      return { ok: true, scopeName: scopeName };
    }
    const msg = (err.response && err.response.data && err.response.data.message) || err.message;
    return { ok: false, scopeName: scopeName, error: msg };
  }
}

/**
 * Run the PingOne configuration check and auto-fix missing scopes.
 * Always resolves (never throws) so callers don't need try/catch.
 */
async function runStartupValidation() {
  // Opt-out: explicit false disables entirely.
  const rawFlag = configStore.getEffective('pingone_validate_on_startup');
  if (String(rawFlag || '').toLowerCase() === 'false') {
    return; // explicitly disabled
  }

  // Skip silently when management worker credentials are absent.
  const mgmtClientId =
    configStore.getEffective('pingone_worker_client_id') ||
    configStore.getEffective('pingone_mgmt_client_id') ||
    configStore.getEffective('pingone_management_client_id');
  if (!mgmtClientId) {
    return; // silent — no credentials, validation would 401 anyway
  }

  console.log(TAG + ' Starting PingOne configuration validation...');

  try {
    // Step 1: validate resource servers exist with correct audiences
    const resourceResult = await validateResources();
    if (resourceResult.status === 'error') {
      console.warn(TAG + ' Resource validation failed: ' + resourceResult.error);
      return;
    }

    const resources = resourceResult.resourceValidation;
    const resourceIssues = resources.filter((r) => r.status === 'MISSING' || r.status === 'CONFIG_ERROR');

    if (resourceIssues.length > 0) {
      console.warn(TAG + ' Resource server issues detected:');
      resourceIssues.forEach((r) => {
        if (r.status === 'MISSING') {
          console.warn(TAG + '   MISSING  "' + r.name + '" — expected audience: ' + r.expectedAudience);
        } else {
          console.warn(TAG + '   CONFIG_ERROR  "' + r.name + '" — got audience "' + r.audience + '", expected "' + r.expectedAudience + '"');
        }
      });
      console.warn(TAG + '   Fix: run docs/PINGONE_CONFIG.md resource setup, then restart.');
    }

    // Step 2: audit scopes on resources that were found
    const presentResources = resources.filter((r) => r.status !== 'MISSING');
    const scopeResult = await auditResourceScopes(presentResources);
    if (scopeResult.status === 'error') {
      console.warn(TAG + ' Scope audit failed: ' + scopeResult.error);
      return;
    }

    const scopeIssues = scopeResult.scopeAudit.filter((r) => r.status !== 'CORRECT');
    let autoFixCount = 0;
    let autoFixFailed = 0;

    if (scopeIssues.length > 0) {
      // Fetch token once for all create calls
      let token, apiBase;
      try {
        const envId  = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
        const region = configStore.getEffective('PINGONE_REGION') || 'com';
        token   = await getManagementToken();
        apiBase = 'https://api.pingone.' + region + '/v1/environments/' + envId;
      } catch (tokenErr) {
        console.warn(TAG + ' Could not obtain management token for scope auto-fix: ' + tokenErr.message);
        // Still log the issues even if we can't fix them
        token = null;
      }

      for (let i = 0; i < scopeIssues.length; i++) {
        const r = scopeIssues[i];
        const m = r.mismatches || {};

        if (m.missing && m.missing.length > 0) {
          if (token && r.resourceId) {
            console.log(TAG + ' Auto-creating ' + m.missing.length + ' missing scope(s) on "' + r.name + '": ' + m.missing.join(', '));
            for (let j = 0; j < m.missing.length; j++) {
              const fix = await _createScope(r.resourceId, m.missing[j], apiBase, token);
              if (fix.ok) {
                console.log(TAG + '   created scope "' + fix.scopeName + '" on "' + r.name + '"');
                autoFixCount++;
              } else {
                console.warn(TAG + '   FAILED to create scope "' + fix.scopeName + '" on "' + r.name + '": ' + fix.error);
                autoFixFailed++;
              }
            }
          } else {
            console.warn(TAG + '   "' + r.name + '" missing scopes: ' + m.missing.join(', '));
          }
        }

        if (m.extra && m.extra.length > 0) {
          // Log only — never auto-delete (extra scopes can't break the demo)
          console.warn(TAG + '   "' + r.name + '" extra scopes (not auto-removed): ' + m.extra.join(', '));
        }

        if (r.status === 'ERROR') {
          console.warn(TAG + '   "' + r.name + '" scope fetch error: ' + r.error);
        }
      }
    }

    const totalIssues = resourceIssues.length + scopeIssues.length;
    if (totalIssues === 0) {
      console.log(TAG + ' PingOne configuration looks correct — all resource servers and scopes match.');
    } else if (autoFixCount > 0 && autoFixFailed === 0) {
      console.log(TAG + ' PingOne validation complete — auto-created ' + autoFixCount + ' missing scope(s). ' + resourceIssues.length + ' resource issue(s) still need manual fix.');
    } else {
      const fixNote = autoFixCount > 0 ? ' (' + autoFixCount + ' auto-created, ' + autoFixFailed + ' failed)' : '';
      console.warn(TAG + ' PingOne validation complete — ' + totalIssues + ' issue(s) found' + fixNote + '. See warnings above.');
    }
  } catch (err) {
    // Network errors, auth failures, etc. — warn and continue; never block startup.
    console.warn(TAG + ' Validation skipped due to unexpected error: ' + err.message);
  }
}

module.exports = { runStartupValidation };
