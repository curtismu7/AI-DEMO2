/**
 * pingoneStartupValidator.js
 *
 * Optional PingOne configuration check that runs once at server start.
 *
 * Enabled by setting PINGONE_VALIDATE_ON_STARTUP=true in .env or via the
 * /config admin UI (same configStore key).
 *
 * The check is fully non-blocking — it never delays startup or rejects requests.
 * On failure it logs warnings to stdout; on success it logs a single ✅ line.
 *
 * What is checked:
 *   1. Resource servers — all four Demo resource servers exist in PingOne with
 *      the correct audience value (enduser.ping.demo, agentgateway.ping.demo,
 *      mcpgateway.ping.demo, mcpserver.ping.demo).
 *   2. Resource scopes — each resource has the expected set of scopes; any
 *      missing or extra scopes are listed.
 *
 * The check is skipped (silently) when:
 *   - Management worker credentials are not configured
 *   - PINGONE_VALIDATE_ON_STARTUP is not set to 'true'
 *   - PingOne is unreachable (network error)
 *
 * See docs/PINGONE_CONFIG.md for the authoritative list of expected values.
 */

const configStore = require('./configStore');
const { validateResources } = require('./resourceValidationService');
const { auditResourceScopes } = require('./scopeAuditService');

const TAG = '[pingone-startup]';

/**
 * Run the PingOne configuration check and log results.
 * Always resolves (never throws) so callers don't need try/catch.
 */
async function runStartupValidation() {
  // WR-02: normalize to lowercase 'true' so TRUE / 1 / true all work
  const enabledRaw = configStore.getEffective('pingone_validate_on_startup');
  const enabled = String(enabledRaw || '').toLowerCase() === 'true';
  if (!enabled) {
    return; // opt-in only — PINGONE_VALIDATE_ON_STARTUP=true to enable
  }

  // CR-01: The downstream getManagementToken() reads worker credentials
  // (pingone_worker_client_id), not MGMT_CLIENT_ID. Check the actual key it
  // uses so we don't silently skip on freshly bootstrapped machines.
  // WR-01: use consistent snake_case keys throughout this function.
  const mgmtClientId =
    configStore.getEffective('pingone_worker_client_id') ||
    configStore.getEffective('pingone_mgmt_client_id') ||
    configStore.getEffective('pingone_management_client_id');
  if (!mgmtClientId) {
    console.warn(
      `${TAG} Skipped — management worker credentials not configured.` +
      ' Set PINGONE_WORKER_CLIENT_ID + PINGONE_WORKER_CLIENT_SECRET to enable.'
    );
    return;
  }

  console.log(`${TAG} Starting PingOne configuration validation...`);

  try {
    // Step 1: validate resource servers exist with correct audiences
    const resourceResult = await validateResources();
    if (resourceResult.status === 'error') {
      console.warn(`${TAG} ⚠️  Resource validation failed: ${resourceResult.error}`);
      return;
    }

    const resources = resourceResult.resourceValidation;
    const resourceIssues = resources.filter(
      (r) => r.status === 'MISSING' || r.status === 'CONFIG_ERROR'
    );

    if (resourceIssues.length > 0) {
      console.warn(`${TAG} ⚠️  Resource server issues detected:`);
      resourceIssues.forEach((r) => {
        if (r.status === 'MISSING') {
          console.warn(`${TAG}   MISSING  "${r.name}" — expected audience: ${r.expectedAudience}`);
        } else {
          console.warn(`${TAG}   CONFIG_ERROR  "${r.name}" — got audience "${r.audience}", expected "${r.expectedAudience}"`);
        }
      });
      console.warn(`${TAG}   Fix: run docs/PINGONE_CONFIG.md resource setup, then restart.`);
    }

    // Step 2: audit scopes on resources that were found
    const scopeResult = await auditResourceScopes(
      resources.filter((r) => r.status !== 'MISSING')
    );
    if (scopeResult.status === 'error') {
      console.warn(`${TAG} ⚠️  Scope audit failed: ${scopeResult.error}`);
      return;
    }

    const scopeIssues = scopeResult.scopeAudit.filter((r) => r.status !== 'CORRECT');
    if (scopeIssues.length > 0) {
      console.warn(`${TAG} ⚠️  Scope mismatches detected:`);
      scopeIssues.forEach((r) => {
        const m = r.mismatches || {};
        if (m.missing && m.missing.length > 0) {
          console.warn(`${TAG}   "${r.name}" missing scopes: ${m.missing.join(', ')}`);
        }
        if (m.extra && m.extra.length > 0) {
          console.warn(`${TAG}   "${r.name}" extra scopes: ${m.extra.join(', ')}`);
        }
        if (r.status === 'ERROR') {
          console.warn(`${TAG}   "${r.name}" scope fetch error: ${r.error}`);
        }
      });
    }

    const totalIssues = resourceIssues.length + scopeIssues.length;
    if (totalIssues === 0) {
      console.log(`${TAG} ✅ PingOne configuration looks correct — all resource servers and scopes match.`);
    } else {
      console.warn(`${TAG} ⚠️  PingOne validation complete — ${totalIssues} issue(s) found. See warnings above.`);
    }
  } catch (err) {
    // Network errors, auth failures, etc. — warn and continue; never block startup.
    console.warn(`${TAG} ⚠️  Validation skipped due to unexpected error: ${err.message}`);
  }
}

module.exports = { runStartupValidation };
