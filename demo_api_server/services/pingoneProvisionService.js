/**
 * PingOne Provisioning Service
 * 
 * Automated setup service for creating PingOne resources via Management API.
 * Creates apps, resource servers, scopes, and demo users with SSE streaming progress.
 */

'use strict';

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { getTokenEndpoint } = require('./oauthEndpointResolver');
const scopeTopology = require('./scopeTopology');

const _rawTopology = require('../../scope-topology.json');
const _PROVISIONING = _rawTopology.provisioning || {};

function _provisioningAppName(internalKey) {
  return (_PROVISIONING.appNames || {})[internalKey] || internalKey;
}

function _provisioningResourceName(internalKey) {
  return (_PROVISIONING.resourceNames || {})[internalKey] || internalKey;
}

// scope-topology.json (v2) is the SINGLE SOURCE OF TRUTH for which scopes
// exist on each PingOne resource server and which scopes each app is granted.
// These helpers convert topology scope-name lists into the {name,description}
// shape createScopes() expects (descriptions come from scopeTopology.scopeMeta
// so the doc, policy engine, and provisioning never drift apart). Editing the
// manifest is the ONLY place scope membership changes — bootstrap derives.

/** {name,description}[] for every scope (native + RFC 8693 mirrored) a
 *  resource server must carry, per the topology. */
function topologyResourceScopeObjects(resourceName) {
  return scopeTopology.resourceScopes(resourceName).map((name) => {
    const meta = scopeTopology.scopeMeta(name);
    return { name, description: (meta && meta.description) || `Scope: ${name}` };
  });
}

/** Scope-name[] an app is granted, per the topology. */
function topologyAppGrantedScopes(appName) {
  return scopeTopology.appGrantedScopes(appName);
}

// Standard demo password for the demoUser / demoAdmin accounts — the two users
// that must exist for hardening (see demoPersonaRoleHardening.js). Overridable via
// DEMO_PASSWORD so operators can set a strong value on a fresh install; the
// default is a known-good password that makes onboarding / regression testing
// trivial. Keep this in sync with the password shown in setupFresh.js /
// bootstrapPingOne.js onboarding output.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Baseball123!';

// Known redirect origins across all deployment targets.
// Bootstrap registers ALL of these so the same PingOne tenant works in local
// dev, Docker Compose, the SE DevOps cluster, and any custom PUBLIC_APP_URL.
// Paths are appended per-app below.
const KNOWN_REDIRECT_ORIGINS = [
  'https://demo-api-server:3001',         // local dev
  'https://ai-demo.ping-devops.com'       // SE DevOps cluster (Ping AWS / k8s)
];

/**
 * Derive a well-formed email domain from the public app URL.
 *
 * Strips the scheme AND port — PingOne's email validator rejects
 * 'demoUser@demo-api-server:3001' because the colon+port isn't a valid email
 * domain (RFC 5321). It also rejects single-label domains like 'localhost',
 * so we fall back to a plausible synthetic domain in that case.
 *
 *   https://demo-api-server:3001  → 'demo-api-server'
 *   http://localhost:4000       → 'demo.invalid'   (RFC 6761 reserved)
 *   https://example.com         → 'example.com'
 */
function demoEmailDomain(publicAppUrl) {
  const stripped = String(publicAppUrl || '')
    .replace(/^https?:\/\//, '')   // drop scheme
    .replace(/\/.*$/, '')          // drop path
    .replace(/:\d+$/, '');          // drop :port
  // RFC 5321 requires at least one dot in the domain part for most validators.
  if (!stripped || !stripped.includes('.')) return 'demo.invalid';
  return stripped;
}

/**
 * Render a step message for createScopes' results.
 * Distinguishes 'created' (newly POSTed) from 'reused' (already existed) so the
 * user doesn't see "Created 0 scopes, 15 failed" on a rerun where everything
 * was actually fine.
 */
function pushScopeResultStep(steps, stepKey, label, results) {
  const created = results.filter(r => r.success && !r.reused).length;
  const reused  = results.filter(r => r.success && r.reused).length;
  const failed  = results.filter(r => !r.success).length;
  let icon, message;
  if (failed > 0) {
    icon = '❌';
    message = `${label}: ${created} created, ${reused} reused, ${failed} FAILED`;
  } else if (created === 0 && reused > 0) {
    icon = '✅';
    message = `${label}: ${reused} reused (all already existed)`;
  } else if (reused > 0) {
    icon = '✅';
    message = `${label}: ${created} created, ${reused} reused`;
  } else {
    icon = '✅';
    message = `${label}: ${created} created`;
  }
  steps.push({ step: stepKey, icon, message });
}

/**
 * Render a step message for one OR more grantScopesToApplication results
 * (some apps grant from multiple resource servers). Combines them.
 */
function pushGrantResultStep(steps, stepKey, label, results) {
  const arr = Array.isArray(results) ? results : [results];
  const failed = arr.filter(r => !r.success);
  if (failed.length > 0) {
    const reasons = failed.map(r => r.error).join('; ');
    steps.push({ step: stepKey, icon: '❌', message: `${label}: grant FAILED — ${reasons}` });
    return;
  }
  // Special case: all results were 'skipped' (e.g. WORKER apps don't accept
  // scope grants — PingOne uses roles for those). Single benign step.
  if (arr.every(r => r.action === 'skipped')) {
    const reason = arr[0].skippedReason || 'not applicable';
    steps.push({ step: stepKey, icon: '✅', message: `${label}: skipped — ${reason}` });
    return;
  }

  const totals = arr.reduce(
    (acc, r) => {
      if (r.action === 'created') acc.created += (r.granted || 0);
      else if (r.action === 'merged') acc.added += (r.addedCount || 0);
      else if (r.action === 'unchanged') acc.unchanged += (r.granted || 0);
      else if (r.action === 'skipped') acc.skipped += 1;
      acc.missing.push(...(r.missingScopes || []));
      return acc;
    },
    { created: 0, added: 0, unchanged: 0, skipped: 0, missing: [] }
  );

  let icon, message;
  const summaryParts = [];
  if (totals.created) summaryParts.push(`${totals.created} created`);
  if (totals.added) summaryParts.push(`${totals.added} added to existing grant`);
  if (totals.unchanged) summaryParts.push(`${totals.unchanged} unchanged`);
  if (totals.skipped) summaryParts.push(`${totals.skipped} skipped`);
  if (totals.missing.length) summaryParts.push(`${totals.missing.length} not found on resource (${totals.missing.slice(0, 3).join(', ')}${totals.missing.length > 3 ? '…' : ''})`);

  if (totals.missing.length > 0) {
    icon = '⚠️';
    message = `${label}: ${summaryParts.join(', ')}`;
  } else {
    icon = '✅';
    message = `${label}: ${summaryParts.join(', ') || 'granted'}`;
  }
  steps.push({ step: stepKey, icon, message });
}

/**
 * Render a step message for createApplication's result. Surfaces drift info
 * so the user can see when an existing app was patched (and which fields).
 *
 * Result shapes from createApplication:
 *   { exists: false }                                 → created fresh
 *   { exists: true, patched: false }                  → reused as-is
 *   { exists: true, patched: true, driftedFields }    → drift detected + patched
 *   { exists: true, patched: false, patchError }      → patch attempt failed
 */
function pushAppResultStep(steps, stepKey, label, result) {
  if (!result.exists) {
    steps.push({ step: stepKey, icon: '✅', message: `${label} created` });
  } else if (result.patched) {
    steps.push({
      step: stepKey,
      icon: '🔁',
      message: `${label} already existed — patched drift in: ${result.driftedFields.join(', ')}`,
      resourceKey: result.resourceKey,
    });
  } else if (result.patchError) {
    steps.push({
      step: stepKey,
      icon: '⚠️',
      message: `${label} already existed — drift detected but patch failed: ${result.patchError}`,
      resourceKey: result.resourceKey,
    });
  } else {
    steps.push({
      step: stepKey,
      icon: '✅',
      message: `${label} already exists (reused)`,
      resourceKey: result.resourceKey,
    });
  }
}

class PingOneProvisionService {
  constructor() {
    this.baseURL = null;
    this.workerToken = null;
    this.envId = null;
    this.region = null;
    this.populationId = null;
  }

  /**
   * Get worker token using client credentials flow
   */
  async getWorkerToken(envId, clientId, clientSecret, region = 'com') {
    // Always derive the token URL from the user's submitted envId+region.
    // We deliberately ignore getTokenEndpoint() here because it can leak a
    // stale value from configStore / a prior install / dev .env, sending the
    // call to the wrong environment and producing a misleading invalid_client
    // response (the credentials are right, the env URL is wrong).
    const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;
    try {
      const response = await axios.post(
        tokenUrl,
        'grant_type=client_credentials',
        {
          auth: { username: clientId, password: clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000
        }
      );
      return response.data.access_token;
    } catch (error) {
      // Surface PingOne's full error envelope so the user can act on it without
      // chasing a correlation ID. PingOne returns:
      //   { error: "access_denied",
      //     error_description: "Request denied: Application does not have any role assignments (Correlation ID: ...)",
      //     details: [{ code: "...", message: "..." }] }
      const lines = [];
      const status = error.response?.status;
      const data   = error.response?.data;

      lines.push(`Failed to get worker token from PingOne.`);
      lines.push(`  Endpoint:     ${tokenUrl}`);
      lines.push(`  Region:       ${region}`);
      lines.push(`  Environment:  ${envId}`);
      lines.push(`  Client ID:    ${clientId}`);
      if (status) lines.push(`  HTTP status:  ${status}`);
      if (data?.error) lines.push(`  PingOne code: ${data.error}`);
      if (data?.error_description) lines.push(`  Description:  ${data.error_description}`);
      if (Array.isArray(data?.details) && data.details.length > 0) {
        lines.push(`  Details:`);
        for (const d of data.details) {
          if (d.code || d.message) lines.push(`    - ${d.code || ''}${d.code && d.message ? ': ' : ''}${d.message || ''}`);
          if (d.target) lines.push(`      target: ${d.target}`);
          if (Array.isArray(d.innerError)) {
            for (const inner of d.innerError) {
              lines.push(`      inner: ${inner.code || ''} ${inner.message || ''}`.trim());
            }
          }
        }
      }
      if (!data && error.message) lines.push(`  Network error: ${error.message}`);

      // Friendly hint based on the most common error codes we see.
      const code = data?.error;
      const desc = data?.error_description || '';
      if (code === 'access_denied' && /role assignment/i.test(desc)) {
        lines.push('');
        lines.push('  What happened: PingOne accepted the credentials but the worker app has no');
        lines.push('  admin role, so it cannot call the Management API.');
        lines.push('');
        lines.push('  Fix (takes ~2 minutes):');
        lines.push('    1. Open https://console.pingone.com → your environment');
        lines.push('    2. Applications → find your worker app (Client ID shown above)');
        lines.push('    3. Click the Roles tab → Grant Roles');
        lines.push('    4. Add "Identity Data Admin" — scope it to this environment:');
        lines.push(`       ${envId}`);
        lines.push('    5. Save, wait 30 seconds, then re-run:  npm run pingone:bootstrap');
        lines.push('       (your credentials are cached — it will not ask again)');
      } else if (code === 'invalid_client') {
        lines.push('');
        lines.push('  What happened: PingOne rejected the Client ID or Client Secret.');
        lines.push('  The credentials are wrong, expired, or the app has been disabled.');
        lines.push('');
        lines.push('  Fix:');
        lines.push('    1. Open https://console.pingone.com → Applications → find your worker app');
        lines.push('    2. Confirm the app is Enabled (toggle on the Overview tab)');
        lines.push(`    3. Confirm the region is correct — currently set to: ${region}`);
        lines.push('       (should match your console URL: console.pingone.com → com,');
        lines.push('        console.pingone.eu → eu, console.pingone.ca → ca, etc.)');
        lines.push('    4. If you recently regenerated the secret, paste the new one');
        lines.push('    5. Re-run:  npm run pingone:bootstrap --reset-creds');
        lines.push('       (--reset-creds clears the cache so you are prompted for new values)');
      } else if (code === 'invalid_grant' || /grant.*type/i.test(desc)) {
        lines.push('');
        lines.push('  What happened: the worker app exists and authenticated, but it is not');
        lines.push('  configured to use the Client Credentials grant type.');
        lines.push('');
        lines.push('  Fix:');
        lines.push('    1. Open https://console.pingone.com → Applications → find your worker app');
        lines.push('    2. Click the Configuration tab → Grant Type section');
        lines.push('    3. Enable "Client Credentials"');
        lines.push('    4. Save, then re-run:  npm run pingone:bootstrap');
        lines.push('       (your credentials are cached — it will not ask again)');
      }

      const err = new Error(lines.join('\n'));
      err.pingone = { status, code, desc, details: data?.details };
      throw err;
    }
  }

  /**
   * Initialize the service with worker credentials
   */
  async initialize(envId, workerClientId, workerClientSecret, region = 'com') {
    this.envId = envId;
    this.region = region;
    // PingOne Management API base. Endpoint paths in this file are like
    // '/populations', '/applications', etc. — they're appended to baseURL.
    // The full path MUST include /v1/environments/<envId>/. A previous version
    // was missing the /v1/environments prefix, which made every call land on
    // an unrelated PingOne URL that responded with 403 Forbidden — looking
    // exactly like a permission error even though the token was fine.
    this.baseURL = `https://api.pingone.${region}/v1/environments/${envId}`;
    this.workerToken = await this.getWorkerToken(envId, workerClientId, workerClientSecret, region);
    
    // Get default population ID for user creation
    await this.getPopulationId();
  }

  /**
   * Get default population ID
   */
  async getPopulationId() {
    try {
      const response = await this.makeRequest('GET', '/populations');
      const populations = response.data._embedded?.populations || [];
      const defaultPop = populations.find(pop => pop.default) || populations[0];
      
      if (!defaultPop) {
        throw new Error('No population found in environment');
      }
      
      this.populationId = defaultPop.id;
      return this.populationId;
    } catch (error) {
      throw new Error(`Failed to get population ID: ${error.message}`);
    }
  }

  /**
   * Make authenticated request to PingOne Management API
   */
  async makeRequest(method, endpoint, data = null, customHeaders = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.workerToken}`,
      'Content-Type': 'application/json',
      ...customHeaders
    };

    try {
      const config = { method, url, headers };
      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response;
    } catch (error) {
      // PingOne returns: { code, message, details: [{ code, message, target?, innerError? }] }
      const status = error.response?.status;
      const data   = error.response?.data;
      const parts  = [`${method} ${endpoint} failed`];
      if (status) parts.push(`HTTP ${status}`);
      if (data?.code) parts.push(`code=${data.code}`);
      const detailMsg = data?.details?.[0]?.message;
      const topMsg    = data?.message;
      if (detailMsg && detailMsg !== topMsg) parts.push(detailMsg);
      else if (topMsg) parts.push(topMsg);
      else if (!data && error.message) parts.push(error.message);
      const err = new Error(parts.join(' — '));
      err.pingone = { status, code: data?.code, details: data?.details, url };
      throw err;
    }
  }

  /**
   * Check if resource exists by name
   */
  async findResourceByName(type, name) {
    try {
      const endpoint = type === 'application' ? '/applications' : '/resources';
      // PingOne defaults to 20 items per page — use limit=100 to avoid
      // missing an existing resource and triggering a duplicate-name 400.
      const response = await this.makeRequest('GET', `${endpoint}?limit=100`);

      const resources = response.data._embedded?.[type === 'application' ? 'applications' : 'resources'] || [];
      return resources.find(resource => resource.name === name);
    } catch (error) {
      return null; // Resource doesn't exist or access denied
    }
  }

  /**
   * Create resource server
   */
  async createResourceServer(name, description, audience) {
    const existing = await this.findResourceByName('resource', name);
    if (existing) {
      // PingOne returns audience as a string on GET; wrap it so callers that
      // read resource.audience[0] (see pingoneProvisionService.js:1014/1017/1026
      // ENDUSER_AUDIENCE / MCP_RESOURCE_URI / MCP_GW_RESOURCE_URI writers) get
      // a URI, not a single character. Without this, the idempotent rerun path
      // wrote `ENDUSER_AUDIENCE=b` (first char of 'banking-...') into .env.
      if (typeof existing.audience === 'string') {
        existing.audience = [existing.audience];
      }
      return {
        exists: true,
        resource: existing,
        resourceKey: `resource:${existing.id}`
      };
    }

    // PingOne /resources schema:
    //   - type: enum { OPENID_CONNECT, PINGONE_API, CUSTOM } — must be CUSTOM
    //     for our use case (NOT the URN string we used to send).
    //   - audience: STRING (single value), not an array. Sending an array
    //     produces "INVALID_VALUE for attribute audience" → INVALID_REQUEST.
    //   - audience is optional; omitting it defaults to `name`. We pass the
    //     caller-provided audience explicitly so callers can use a stable
    //     loopback hostname like `api.ping.demo`.
    const data = {
      name,
      description,
      type: 'CUSTOM',
      audience,
    };

    let response;
    try {
      response = await this.makeRequest('POST', '/resources', data);
    } catch (postErr) {
      // If PingOne rejects with "already exists" it means the resource exists
      // under a different name (e.g. a previous bootstrap used a different
      // resourceNames mapping). Fall back to matching by audience string so
      // idempotent reruns don't fail.
      if (postErr.pingone?.code === 'INVALID_DATA' && postErr.message.includes('already exists')) {
        const listRes = await this.makeRequest('GET', '/resources?limit=100');
        const all = listRes.data._embedded?.resources || [];
        const byAudience = all.find(r => r.audience === audience || r.name === name);
        if (byAudience) {
          if (typeof byAudience.audience === 'string') byAudience.audience = [byAudience.audience];
          return { exists: true, resource: byAudience, resourceKey: `resource:${byAudience.id}` };
        }
      }
      throw postErr;
    }
    // The response shape PingOne returns matches our previous expectations:
    // resource has an `audience` field (string), surfaced as a single-item
    // array `audience: [aud]` for backwards-compat — wrap it here so code that
    // reads provisioned.resourceServer.audience[0] still works.
    const resource = response.data;
    if (typeof resource.audience === 'string') {
      resource.audience = [resource.audience];
    }
    return {
      exists: false,
      resource,
      resourceKey: `resource:${resource.id}`,
    };
  }

  /**
   * Create scopes on a resource server, idempotently.
   *
   * For each scope: if a scope with the same name already exists on the
   * resource, return it as a `reused` result (no API write). Otherwise POST.
   * Previously POSTs to existing scopes returned HTTP 400 INVALID_DATA, which
   * the old code reported as `failed` — that produced the misleading
   * "Created 0 scopes, 15 failed" output on rerun.
   */
  async createScopes(resourceId, scopes) {
    // List existing scopes once, build a name→object map.
    const existing = await this.makeRequest('GET', `/resources/${resourceId}/scopes`);
    const existingByName = new Map();
    for (const s of (existing.data._embedded?.scopes || [])) {
      existingByName.set(s.name, s);
    }

    const results = [];
    for (const scope of scopes) {
      const found = existingByName.get(scope.name);
      if (found) {
        results.push({ success: true, reused: true, scope: found, name: scope.name });
        continue;
      }
      try {
        const response = await this.makeRequest('POST', `/resources/${resourceId}/scopes`, {
          name: scope.name,
          description: scope.description,
          schema: 'urn:pingone:common:scope',
        });
        results.push({ success: true, reused: false, scope: response.data, name: scope.name });
      } catch (error) {
        results.push({ success: false, error: error.message, name: scope.name });
      }
    }

    return results;
  }

  /**
   * Create OIDC application.
   *
   * PingOne /applications POST schema rules learned by curl probe:
   *   - protocol is REQUIRED on creation. Empty value → INVALID_DATA.
   *   - grantTypes uses the canonical UPPERCASE enum form (AUTHORIZATION_CODE,
   *     CLIENT_CREDENTIALS, REFRESH_TOKEN, TOKEN_EXCHANGE, IMPLICIT, etc).
   *     RFC 6749 lowercase ("authorization_code") is silently rejected.
   *   - tokenEndpointAuthMethod also uses UPPERCASE (CLIENT_SECRET_BASIC etc).
   *   - pkceEnforcement, not pkceMethod (different field name + uppercase enum).
   *   - responseTypes is required for WEB_APP (CODE / TOKEN / ID_TOKEN).
   *   - WORKER apps don't accept refreshToken / pkceEnforcement / responseTypes;
   *     leaving those fields off lets PingOne pick correct defaults.
   *
   * The grantTypes / tokenEndpointAuthMethod input parameters are accepted in
   * either lowercase (legacy) or uppercase form — we normalize to UPPERCASE
   * before sending so existing callers don't all have to change at once.
   */
  async createApplication(name, description, type, grantTypes, tokenEndpointAuthMethod) {
    // Normalize grants once and reuse.
    const normalizeGrant = (g) => {
      if (g === 'urn:ietf:params:oauth:grant-type:token-exchange') return 'TOKEN_EXCHANGE';
      if (g === 'token_exchange') return 'TOKEN_EXCHANGE';
      return String(g).toUpperCase();
    };
    const desiredGrants = new Set((grantTypes || []).map(normalizeGrant));
    // ARCHITECTURE TRUTH T-9: every PingOne client connection uses
    // client_secret_post. The ONLY exception is the Management-API Worker
    // Token CC client, identified by NAME — NOT by PingOne type===WORKER.
    // Several apps are type WORKER (MCP Server, MCP Gateway, Agent) yet the
    // BFF authenticates them with client_secret_post ([CC-As] method=post);
    // only the single Management worker stays basic. Keying off type would
    // wrongly force those three back to basic.
    // Match against the provisioning display name (may be 'Demo AI App - Introspection Worker',
    // 'BX Finance - Introspection Worker', 'Demo Worker', or legacy 'Super Banking Worker'
    // depending on scope-topology.json). tokenEndpointAuthMethod param overrides the default
    // when explicitly supplied (e.g. 'none' for PKCE-only apps that have no client secret).
    const _mgmtWorkerDisplayName = _provisioningAppName('Super Banking Worker');
    const isMgmtWorkerApp = String(name || '').trim() === _mgmtWorkerDisplayName ||
                            String(name || '').trim() === 'Super Banking Worker' ||
                            String(name || '').trim() === 'Demo Worker' ||
                            String(name || '').trim() === 'BX Finance - Introspection Worker';
    const desiredAuthMethod = tokenEndpointAuthMethod
      ? String(tokenEndpointAuthMethod).toUpperCase()
      : (isMgmtWorkerApp ? 'CLIENT_SECRET_BASIC' : 'CLIENT_SECRET_POST');

    const existing = await this.findResourceByName('application', name);

    // Drift handling on existing apps: prefer patching; only delete + recreate
    // when the type itself changed (PingOne won't let you change app type via
    // PUT). We don't touch redirectUris here — the wizard's per-app
    // updateApplication() steps set those with the current hostname; that's
    // already an idempotent PUT-with-merge.
    if (existing) {
      // Type mismatch → can't patch, must recreate.
      if (existing.type !== type) {
        try {
          await this.makeRequest('DELETE', `/applications/${existing.id}`);
        } catch (_e) { /* fall through; create will fail with a clear error */ }
        // fall out of this block to the create path below
      } else {
        // Compare patchable fields. PingOne's existing.grantTypes is already
        // uppercase, so set-equality works.
        const currentGrants = new Set((existing.grantTypes || []).map(g => String(g).toUpperCase()));
        const grantsDrift = currentGrants.size !== desiredGrants.size ||
                            [...desiredGrants].some(g => !currentGrants.has(g));
        const authDrift = String(existing.tokenEndpointAuthMethod || '').toUpperCase() !== desiredAuthMethod;
        const enabledDrift = existing.enabled !== true;

        if (grantsDrift || authDrift || enabledDrift) {
          const patch = {};
          if (grantsDrift) patch.grantTypes = [...desiredGrants];
          if (authDrift) patch.tokenEndpointAuthMethod = desiredAuthMethod;
          if (enabledDrift) patch.enabled = true;
          try {
            await this.updateApplication(existing.id, patch);
          } catch (err) {
            // Patching failed — surface the error but keep existing app rather
            // than destroying it.
            return {
              exists: true,
              patched: false,
              patchError: err.message,
              application: existing,
              resourceKey: `application:${existing.id}`,
            };
          }
          // Re-fetch so callers see the updated state.
          const refreshed = (await this.makeRequest('GET', `/applications/${existing.id}`)).data;
          return {
            exists: true,
            patched: true,
            driftedFields: Object.keys(patch),
            application: refreshed,
            resourceKey: `application:${refreshed.id}`,
          };
        }

        // No drift — return as-is.
        return {
          exists: true,
          patched: false,
          application: existing,
          resourceKey: `application:${existing.id}`,
        };
      }
    }

    // Create path (no existing OR existing was deleted due to type mismatch).
    const data = {
      name,
      description,
      enabled: true,
      type,
      protocol: 'OPENID_CONNECT',
      grantTypes: [...desiredGrants],
      tokenEndpointAuthMethod: desiredAuthMethod,
    };

    // WEB_APP / NATIVE_APP / SINGLE_PAGE_APP need responseTypes + redirectUris
    // setup later via updateApplication. WORKER doesn't.
    //
    // responseTypes:['CODE'] is only valid when the app actually uses the
    // authorization-code flow — PingOne rejects (HTTP 400 INVALID_DATA) a
    // create where responseTypes contains CODE but grantTypes lacks
    // AUTHORIZATION_CODE (e.g. a client-credentials-only WEB_APP like the
    // MCP Server app). Gate the code-flow fields on the grant actually
    // being requested so CC-only non-WORKER apps provision cleanly.
    if (type !== 'WORKER' && desiredGrants.has('AUTHORIZATION_CODE')) {
      data.responseTypes = ['CODE'];
      data.pkceEnforcement = 'S256_REQUIRED';
      data.refreshToken = { rotating: true, reuseTokens: false };
    }

    const response = await this.makeRequest('POST', '/applications', data);
    return {
      exists: false,
      application: response.data,
      resourceKey: `application:${response.data.id}`,
    };
  }

  /**
   * Update application redirect URIs and PKCE settings.
   *
   * Normalizes legacy lowercase enum values to the UPPERCASE form PingOne
   * requires, and rewrites legacy field names that callers may still pass:
   *   pkceMethod    →  pkceEnforcement
   *   grantTypes    →  uppercased + token-exchange URN expanded
   *   tokenEndpointAuthMethod →  uppercased
   *
   * All callers can pass either form; we send the canonical PingOne form.
   */
  async updateApplication(appId, updates) {
    const normalizeGrant = (g) => {
      if (g === 'urn:ietf:params:oauth:grant-type:token-exchange') return 'TOKEN_EXCHANGE';
      if (g === 'token_exchange') return 'TOKEN_EXCHANGE';
      return String(g).toUpperCase();
    };
    const normalized = { ...updates };
    if (Array.isArray(normalized.grantTypes)) {
      normalized.grantTypes = normalized.grantTypes.map(normalizeGrant);
    }
    if (typeof normalized.tokenEndpointAuthMethod === 'string') {
      normalized.tokenEndpointAuthMethod = normalized.tokenEndpointAuthMethod.toUpperCase();
    }
    if (normalized.pkceMethod && !normalized.pkceEnforcement) {
      normalized.pkceEnforcement = String(normalized.pkceMethod).toUpperCase() === 'S256'
        ? 'S256_REQUIRED'
        : String(normalized.pkceMethod).toUpperCase();
      delete normalized.pkceMethod;
    }

    // PingOne PUT /applications/{id} is a FULL replace, not a partial patch —
    // sending only the fields you want to change drops the others (and
    // immediately fails on required fields like 'protocol' with INVALID_DATA).
    // Fetch the current app, merge our changes on top, strip read-only/HATEOAS
    // fields, and send the result.
    const current = (await this.makeRequest('GET', `/applications/${appId}`)).data;
    const READONLY_FIELDS = ['_links', 'environment', 'id', 'createdAt', 'updatedAt', 'clientId', 'signing'];
    const merged = { ...current, ...normalized };
    for (const k of READONLY_FIELDS) delete merged[k];

    const response = await this.makeRequest('PUT', `/applications/${appId}`, merged);
    return response.data;
  }

  /**
   * Fetch the client secret for an application from /applications/{id}/secret.
   * PingOne does NOT return clientSecret on POST /applications — it lives on a
   * separate sub-resource and must be fetched explicitly.
   * Returns null on failure (e.g. NONE auth method, where no secret exists).
   */
  async getApplicationSecret(appId) {
    try {
      const response = await this.makeRequest('GET', `/applications/${appId}/secret`);
      return response.data?.secret || null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Idempotently set a CUSTOM attribute on a resource server.
   * If an attribute with the same name already exists, it's deleted and
   * recreated with the new value (PingOne doesn't accept a name-collision on
   * POST). Reserved CORE attributes (e.g. 'sub') would refuse delete and are
   * skipped.
   */
  async _setResourceAttribute(resourceId, name, value) {
    // Find existing attr by name
    const list = await this.makeRequest('GET', `/resources/${resourceId}/attributes`);
    const existing = (list.data._embedded?.attributes || []).find(a => a.name === name);
    if (existing) {
      if (existing.type === 'CORE') return existing;       // can't delete CORE
      try {
        await this.makeRequest('DELETE', `/resources/${resourceId}/attributes/${existing.id}`);
      } catch (_e) { /* fall through and let POST report a duplicate */ }
    }
    const response = await this.makeRequest('POST', `/resources/${resourceId}/attributes`, {
      name,
      value,
      type: 'CUSTOM',
    });
    return response.data;
  }

  /**
   * Idempotently ensure a CUSTOM user-schema attribute exists.
   * PingOne's schema attribute API rejects re-creation with INVALID_DATA, so we
   * check first and only POST if missing. PingOne user-schema attributes can
   * only be STRING or JSON (BOOLEAN is rejected); we store boolean-ish values
   * as the strings "true" / "false".
   */
  async _ensureUserSchemaAttribute(name, type = 'STRING', displayName = null) {
    // Find the User schema id (cache once per service instance).
    if (!this._userSchemaId) {
      const schemas = (await this.makeRequest('GET', '/schemas?filter=name eq "User"')).data;
      this._userSchemaId = schemas._embedded?.schemas?.[0]?.id;
      if (!this._userSchemaId) throw new Error('User schema not found');
    }
    const attrs = (await this.makeRequest('GET', `/schemas/${this._userSchemaId}/attributes`)).data._embedded?.attributes || [];
    const existing = attrs.find(a => a.name === name);
    if (existing) return existing;

    const response = await this.makeRequest('POST', `/schemas/${this._userSchemaId}/attributes`, {
      name,
      displayName: displayName || name,
      type,
      enabled: true,
      required: false,
      unique: false,
    });
    return response.data;
  }

  /**
   * Idempotently ensure a group exists, return its id.
   */
  async _ensureGroup(name, description = '') {
    const list = (await this.makeRequest('GET', `/groups?filter=name eq "${name}"`)).data._embedded?.groups || [];
    if (list[0]) return list[0].id;
    const response = await this.makeRequest('POST', '/groups', { name, description });
    return response.data.id;
  }

  /**
   * Idempotently ensure a permissive password policy exists.
   *
   * Demo-tuned: lowest-friction policy PingOne will accept.
   *   - length min 8 (PingOne floor; can't go below)
   *   - no character-class requirements (no minCharacters)
   *   - no commonly-used dictionary check
   *   - no profile-data similarity check
   *   - no current-password similarity check
   *   - no history field (only PingOne's hardcoded floor "can't reuse current
   *     password" still applies — there's no API to disable that)
   *   - no age limits, no max-repeat, no min-unique
   *
   * Returns the policy id.
   */
  async _ensurePasswordPolicy(name, description = '') {
    const list = (await this.makeRequest('GET', '/passwordPolicies')).data._embedded?.passwordPolicies || [];
    const existing = list.find(p => p.name === name);
    if (existing) return existing.id;

    const response = await this.makeRequest('POST', '/passwordPolicies', {
      name,
      description: description || 'Demo-friendly password policy: 8-char minimum, no other rules.',
      excludesProfileData: false,
      notSimilarToCurrent: false,
      excludesCommonlyUsed: false,
      length: { min: 8, max: 255 },
      // Intentionally omit history/lockout/minCharacters/age fields — those
      // become "no rule" when absent from the policy.
    });
    return response.data.id;
  }

  /**
   * Bind a password policy to a population. PingOne's PUT /populations/{id}
   * is FULL replace — must include name, default flag, and other fields or
   * they get reset. We preserve the population's existing fields and only
   * change passwordPolicy.
   */
  async _bindPopulationPolicy(populationId, policyId) {
    const current = (await this.makeRequest('GET', `/populations/${populationId}`)).data;
    const body = {
      name: current.name,
      description: current.description || '',
      default: current.default || false,
      preferredLanguage: current.preferredLanguage,
      passwordPolicy: { id: policyId },
    };
    // Optional fields PingOne may set; only include if non-empty.
    if (current.theme?.id) body.theme = { id: current.theme.id };
    await this.makeRequest('PUT', `/populations/${populationId}`, body);
  }

  /**
   * Idempotently ensure a user carries the demo admin role assignments
   * (Environment Admin + Identity Data Admin, ENVIRONMENT-scoped). PingOne
   * denies interactive Management-API logins for users with ZERO role
   * assignments ("User does not have any role assignments"), which breaks
   * e.g. the pingone-admin MCP server browser login for demo personas.
   * The worker can only grant roles it holds itself; per-role failures are
   * collected, not thrown.
   */
  async _ensureAdminRoleAssignments(userId) {
    const ROLE_NAMES = ['Environment Admin', 'Identity Data Admin'];
    const result = { assigned: [], existing: [], failed: [] };

    if (!this._roleIdsByName) {
      // Org-level endpoint — not under /environments, so not via makeRequest.
      const { data } = await axios.get(`https://api.pingone.${this.region}/v1/roles`, {
        headers: { Authorization: `Bearer ${this.workerToken}` },
        timeout: 20000,
      });
      this._roleIdsByName = {};
      for (const r of data._embedded?.roles || []) this._roleIdsByName[r.name] = r.id;
    }

    const list = await this.makeRequest('GET', `/users/${userId}/roleAssignments`);
    const current = list.data._embedded?.roleAssignments || [];

    for (const roleName of ROLE_NAMES) {
      const roleId = this._roleIdsByName[roleName];
      if (!roleId) {
        result.failed.push({ role: roleName, error: 'role not found in /v1/roles' });
        continue;
      }
      if (current.some(ra => ra.role?.id === roleId)) {
        result.existing.push(roleName);
        continue;
      }
      try {
        await this.makeRequest('POST', `/users/${userId}/roleAssignments`, {
          role: { id: roleId },
          scope: { id: this.envId, type: 'ENVIRONMENT' },
        });
        result.assigned.push(roleName);
      } catch (err) {
        if (/unique|already|exist|duplicate/i.test(err.message)) {
          result.existing.push(roleName);
        } else {
          result.failed.push({ role: roleName, error: err.message });
        }
      }
    }
    return result;
  }

  /**
   * Idempotently add user to group via the membership sub-resource.
   * Re-adding a user is a 204 no-op (PingOne handles dedup).
   */
  async _ensureUserInGroup(userId, groupId) {
    try {
      await this.makeRequest('POST', `/users/${userId}/memberOfGroups`, { id: groupId });
    } catch (err) {
      // 409 / "already a member" is success here. Re-throw anything else.
      if (err.pingone?.status === 409 || /already.*member|already exists/i.test(err.message)) return;
      throw err;
    }
  }

  /**
   * Grant scopes to application — idempotent.
   *
   * PingOne /applications/{id}/grants POST payload shape:
   *   { resource: { id: <resourceId> }, scopes: [{ id: <scopeId> }, ...] }
   *
   * NOT { resourceId, scopes: ['name', ...] } — that's what the previous
   * version sent, which is why "Failed to grant scopes" warnings appeared on
   * every grant step. We have to:
   *   1. Look up scope IDs on the resource (input is scope names).
   *   2. Check whether a grant for this resource already exists; if so, MERGE
   *      the new scopes into the existing grant via PUT (POST would 409 on
   *      duplicate resource).
   *   3. Otherwise POST a fresh grant.
   *
   * Inputs:
   *   appId       — application id to grant to
   *   resourceId  — the resource server whose scopes we're granting
   *   scopes      — array of scope NAME strings
   *
   * Returns: { success, action: 'created'|'merged'|'unchanged', granted: number }
   */
  async grantScopesToApplication(appId, resourceId, scopeNames) {
    try {
      // 0. PingOne forbids resource access grants on WORKER apps for any
      //    resource other than 'openid'. WORKERs auth via client_credentials
      //    and use ROLE assignments, not scope grants — see
      //    https://apidocs.pingidentity.com (REQUEST_FAILED on POST /grants).
      //    Treat as benign skip rather than fail.
      const app = (await this.makeRequest('GET', `/applications/${appId}`)).data;
      if (app.type === 'WORKER') {
        return {
          success: true,
          action: 'skipped',
          skippedReason: 'WORKER apps use roles, not scope grants',
          granted: 0,
        };
      }

      // 1. Resolve scope names → ids on the target resource.
      const resourceScopes = (await this.makeRequest('GET', `/resources/${resourceId}/scopes`))
        .data._embedded?.scopes || [];
      const idByName = new Map(resourceScopes.map(s => [s.name, s.id]));
      const desiredIds = [];
      const missing = [];
      for (const name of (scopeNames || [])) {
        const id = idByName.get(name);
        if (id) desiredIds.push(id);
        else missing.push(name);
      }
      if (missing.length > 0 && desiredIds.length === 0) {
        return { success: false, error: `No scopes resolved on resource: ${missing.join(', ')}` };
      }
      // Helper to detect "all desired scope names are already granted via
      // other resources" — used after the cross-resource filter below.

      // 2. Find existing grants on this app and figure out which scope NAMES
      //    are already granted by other resources. PingOne enforces a global
      //    "one scope name per app" rule across all that app's grants — even
      //    if the same name comes from two different resources, it's rejected
      //    with INVALID_DATA "Multiple scopes with the same name cannot be
      //    added to the same grant." Filter those out of our desiredIds.
      const existingGrants = (await this.makeRequest('GET', `/applications/${appId}/grants`))
        .data._embedded?.grants || [];

      // Build set of scope names already granted on OTHER resources.
      const otherResourceScopeNames = new Set();
      for (const g of existingGrants) {
        if (g.resource?.id === resourceId) continue;            // skip same resource
        for (const s of (g.scopes || [])) {
          // Look up the name by id from any other resource's scope list.
          // We have idByName for THIS resource; for cross-resource we'd need a
          // lookup. Cheaper: just fetch the names of scopes in this grant.
        }
      }
      // The above can't cheaply resolve cross-resource scope IDs to names.
      // Simpler: pre-fetch ALL resources' scopes once.
      let allOtherNames = new Set();
      for (const g of existingGrants) {
        if (g.resource?.id === resourceId) continue;
        const otherScopes = (await this.makeRequest('GET', `/resources/${g.resource.id}/scopes`))
          .data._embedded?.scopes || [];
        const otherIdToName = new Map(otherScopes.map(s => [s.id, s.name]));
        for (const s of (g.scopes || [])) {
          const n = otherIdToName.get(s.id);
          if (n) allOtherNames.add(n);
        }
      }

      // Filter desiredIds: drop any whose NAME is already granted via another resource.
      const idToName = new Map(resourceScopes.map(s => [s.id, s.name]));
      const filteredIds = desiredIds.filter(id => {
        const name = idToName.get(id);
        return name && !allOtherNames.has(name);
      });
      const droppedAsCrossResource = desiredIds.length - filteredIds.length;
      desiredIds.length = 0;
      desiredIds.push(...filteredIds);

      // If all desired names were already granted via other resources, there's
      // nothing to do here — return a benign skip.
      if (desiredIds.length === 0 && droppedAsCrossResource > 0) {
        return {
          success: true,
          action: 'skipped',
          skippedReason: `all ${droppedAsCrossResource} scope names already granted via other resources on this app`,
          granted: 0,
        };
      }

      const match = existingGrants.find(g => g.resource?.id === resourceId);

      if (match) {
        // Merge: union of (existing scope ids) + desiredIds.
        const existingIds = new Set((match.scopes || []).map(s => s.id));
        const toAdd = desiredIds.filter(id => !existingIds.has(id));
        if (toAdd.length === 0) {
          return { success: true, action: 'unchanged', granted: existingIds.size, missingScopes: missing };
        }
        const merged = [...existingIds, ...toAdd].map(id => ({ id }));
        // PUT replaces the grant in place; PingOne accepts updates here.
        await this.makeRequest('PUT', `/applications/${appId}/grants/${match.id}`, {
          resource: { id: resourceId },
          scopes: merged,
        });
        return { success: true, action: 'merged', granted: merged.length, addedCount: toAdd.length, missingScopes: missing };
      }

      // 3. No existing grant → POST a fresh one.
      // Dedup by id in case the input scopeNames had duplicates upstream.
      const uniqueIds = Array.from(new Set(desiredIds));
      const response = await this.makeRequest('POST', `/applications/${appId}/grants`, {
        resource: { id: resourceId },
        scopes: uniqueIds.map(id => ({ id })),
      });
      return { success: true, action: 'created', granted: uniqueIds.length, grant: response.data, missingScopes: missing };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create user
   */
  async createUser(username, firstName, lastName, email) {
    const existing = await this.findUserByUsername(username);
    if (existing) {
      return { 
        exists: true, 
        user: existing,
        resourceKey: `user:${existing.id}`
      };
    }

    const data = {
      username,
      name: {
        given: firstName,
        family: lastName
      },
      email,
      enabled: true,
      population: { id: this.populationId }
    };

    const response = await this.makeRequest('POST', '/users', data);
    return { 
      exists: false, 
      user: response.data,
      resourceKey: `user:${response.data.id}`
    };
  }

  /**
   * Find user by username
   */
  async findUserByUsername(username) {
    try {
      const response = await this.makeRequest('GET', `/users?filter=username eq "${username}"`);
      const users = response.data._embedded?.users || [];
      return users[0] || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Set user password
   */
  async setUserPassword(userId, password) {
    // PingOne /users/{id}/password expects { value: '<password>' } with the
    // vnd.pingidentity.password.set+json content-type.
    //
    // PingOne enforces password-history (default: cannot reuse the most-recent
    // N passwords). On rerun where the user already has the demo password set,
    // PingOne rejects re-setting to the SAME value with INVALID_DATA + the
    // message "New password did not satisfy password policy requirements."
    //
    // For the demo we treat that specific failure as success-already-set:
    // the password is already what we want, no harm done.
    try {
      const response = await this.makeRequest(
        'PUT',
        `/users/${userId}/password`,
        { value: password },
        { 'Content-Type': 'application/vnd.pingidentity.password.set+json' }
      );
      return { changed: true, ...response.data };
    } catch (err) {
      const desc = String(err.pingone?.details?.[0]?.message || err.message || '');
      if (/password.*polic|did not satisf/i.test(desc)) {
        // Almost certainly the password-history check rejecting "set to same
        // value as already in place". Surface as benign skip rather than fail.
        return { changed: false, skipped: 'password_policy_history' };
      }
      throw err;
    }
  }

  /**
   * Validate that all provisioned apps are in the same environment.
   * Catches bootstrap cache corruption (wrong envId cached).
   */
  validateEnvironmentConsistency(config, provisioned) {
    const envId = config.envId;
    // Note: Worker app is NOT listed here — no separate worker app is created by
    // provisionEnvironment (the bootstrap credentials ARE the worker; see Step 18
    // comment). Including provisioned.workerApp would always yield undefined and
    // the check would silently no-op anyway, but omitting it makes intent clear.
    const apps = [
      { name: 'Admin App', app: provisioned.adminApp },
      { name: 'User App', app: provisioned.userApp },
    ];

    for (const { name, app } of apps) {
      if (app?.environmentId && app.environmentId !== envId) {
        throw new Error(
          `[BOOTSTRAP CORRUPTION] ${name} is in environment ${app.environmentId} ` +
          `but config specifies ${envId}. ` +
          `Delete ~/.ai-demo-creds and re-run bootstrap to fix.`
        );
      }
    }
  }

  /**
   * Write .env file
   * Resolves to banking_api_server/.env regardless of cwd, so the wizard can be
   * invoked from anywhere without clobbering an unrelated .env.
   *
   * Preserves SESSION_SECRET and CONFIG_ENCRYPTION_KEY from any existing .env
   * because configStore derives its config.db encryption key from them — if we
   * generated a fresh value here, an already-encrypted config.db would fail to
   * decrypt on next startup. (Brand-new installs that have no .env yet get a
   * randomly generated SESSION_SECRET written below.)
   */
  async writeEnvFile(config, provisioned) {
    const envPath = path.resolve(__dirname, '..', '.env');

    let preserved = {};
    try {
      const existing = await fs.readFile(envPath, 'utf8');
      const grab = (key) => {
        const m = existing.match(new RegExp(`^${key}=(.+)$`, 'm'));
        return m ? m[1].trim() : null;
      };
      const sessionSecret = grab('SESSION_SECRET');
      const configKey = grab('CONFIG_ENCRYPTION_KEY');
      if (sessionSecret) preserved.SESSION_SECRET = sessionSecret;
      if (configKey) preserved.CONFIG_ENCRYPTION_KEY = configKey;
    } catch (_e) { /* no existing .env — fall through and generate one */ }

    if (!preserved.SESSION_SECRET) {
      preserved.SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');
    }
    if (!preserved.CONFIG_ENCRYPTION_KEY) {
      preserved.CONFIG_ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
    }

    // Preserve BFF_INTERNAL_SECRET across reruns so services sharing it don't break.
    const existingBff = (() => {
      try {
        const text = require('fs').readFileSync(envPath, 'utf8');
        const m = text.match(/^BFF_INTERNAL_SECRET=(.+)$/m);
        return m ? m[1].trim() : null;
      } catch (_) { return null; }
    })();
    preserved.BFF_INTERNAL_SECRET = existingBff || require('crypto').randomBytes(32).toString('hex');

    const envContent = this.generateEnvContent(config, provisioned, preserved);
    await fs.writeFile(envPath, envContent, 'utf8');

    // Mirror the newly-written .env into SQLite so the database is immediately
    // populated — the server can then start without any env file present.
    try {
      require('dotenv').config({ path: envPath, override: true });
      const configStore = require('./configStore');
      await configStore.ensureInitialized();
      configStore._seedFromEnv();
      console.log('[Bootstrap] .env values seeded into SQLite config.db');
    } catch (err) {
      console.warn('[Bootstrap] SQLite seed after writeEnvFile failed (non-fatal):', err.message);
    }

    return envPath;
  }

  /**
   * Durably wire the MCP server's RFC 7662 introspection identity.
   *
   * demo_mcp_server reads demo_mcp_server/.env.development (run-demo.sh
   * ensure_service_env copies it over .env each restart). It is NOT the BFF
   * .env writeEnvFile() generates, and it is gitignored/untracked — so a
   * fresh `setup:fresh` on a no-vault machine would otherwise leave the MCP
   * server pointing at a stale/absent introspection client and every
   * gateway->MCP tool call would 401.
   *
   * PingOne binds introspection to the token's REQUESTING client; the
   * gateway performs the downstream RFC 8693 exchange as the MCP Gateway
   * app, so the MCP server MUST introspect as THAT app. We therefore write
   * the gateway app's clientId/secret as the MCP server's PINGONE_CLIENT_*
   * (the no-vault fallback; the vault's MCP_GW_* still wins when present —
   * environments.ts resolves MCP_GW_* || PINGONE_*). MCP_SERVER_RESOURCE_URI
   * is set to the MCP server's OWN resource (the aud the gateway's exchange
   * targets). See REGRESSION_PLAN.md §4 2026-05-18.
   *
   * Surgical: only the 3 introspection-identity lines are rewritten; every
   * other MCP-specific key in .env.development is preserved. If the file is
   * absent (clean clone before first run-bank), this is a no-op — run-bank's
   * ensure_service_env will materialise .env from the (shipped) template and
   * the vault path covers the identity.
   */
  async writeMcpServerIntrospectionIdentity(provisioned) {
    const devEnvPath = path.resolve(
      __dirname, '..', '..', 'demo_mcp_server', '.env.development',
    );
    let content;
    try {
      content = await fs.readFile(devEnvPath, 'utf8');
    } catch (_e) {
      content = ''; // create from scratch on clean clone
    }

    const gwId = provisioned.mcpGwApp?.clientId;
    const gwSecret = provisioned.mcpGwApp?.clientSecret;
    // In passthrough mode the MCP server receives tokens audienced to the
    // gateway (mcpgateway.ping.demo), not to itself. MCP_SERVER_RESOURCE_URI
    // is the aud the server validates in TokenIntrospector.ts, so it must match
    // the gateway audience — not the MCP server's own resource audience.
    const mcpAud = provisioned.mcpGwResourceServer?.audience?.[0]
      || provisioned.mcpResourceServer?.audience?.[0];
    if (!gwId || !gwSecret || !mcpAud) {
      return null; // gateway app / mcp resource not provisioned — leave as-is
    }

    const envId = provisioned.envId || this.envId;
    const region = provisioned.region || this.region || 'com';
    const encKey = require('node:crypto').randomBytes(32).toString('hex');

    const setLine = (text, key, value) => {
      const re = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${value}`;
      return re.test(text) ? text.replace(re, line) : `${text}\n${line}`;
    };

    // Introspection identity (3 keys — MCP_GW_* wins at runtime via environments.ts fallback)
    content = setLine(content, 'PINGONE_CLIENT_ID', gwId);
    content = setLine(content, 'PINGONE_CLIENT_SECRET', `"${gwSecret}"`);
    content = setLine(content, 'MCP_SERVER_RESOURCE_URI', mcpAud);

    // Derived endpoint vars required by config validator (computed from envId+region)
    content = setLine(content, 'PINGONE_BASE_URL', `https://api.pingone.${region}/v1/environments/${envId}`);
    content = setLine(content, 'PINGONE_INTROSPECTION_ENDPOINT', `https://auth.pingone.${region}/${envId}/as/introspect`);
    content = setLine(content, 'PINGONE_AUTHORIZATION_ENDPOINT', `https://auth.pingone.${region}/${envId}/as/authorize`);
    content = setLine(content, 'PINGONE_TOKEN_ENDPOINT', `https://auth.pingone.${region}/${envId}/as/token`);
    // Only write ENCRYPTION_KEY if not already set (preserve existing key across reruns)
    if (!(/^ENCRYPTION_KEY=.+$/m).test(content)) {
      content = setLine(content, 'ENCRYPTION_KEY', encKey);
    }

    await fs.writeFile(devEnvPath, content, 'utf8');
    return devEnvPath;
  }

  /**
   * Generate .env file content.
   * `preserved` carries SESSION_SECRET / CONFIG_ENCRYPTION_KEY values that must
   * survive the rewrite — see writeEnvFile() for the rationale.
   */
  generateEnvContent(config, provisioned, preserved = {}) {
    const lines = [
      '# PingOne Configuration - Generated by Setup Wizard',
      `PINGONE_ENVIRONMENT_ID=${config.envId}`,
      `PINGONE_REGION=${config.region}`,
      '',
      '# Session / config encryption (preserved from existing .env if present)',
    ];
    if (preserved.SESSION_SECRET) lines.push(`SESSION_SECRET=${preserved.SESSION_SECRET}`);
    if (preserved.CONFIG_ENCRYPTION_KEY) lines.push(`CONFIG_ENCRYPTION_KEY=${preserved.CONFIG_ENCRYPTION_KEY}`);
    if (preserved.BFF_INTERNAL_SECRET) {
      lines.push('');
      lines.push('# Shared internal secret — must match across BFF, MCP Gateway, and Agent Service');
      lines.push(`BFF_INTERNAL_SECRET=${preserved.BFF_INTERNAL_SECRET}`);
    }
    lines.push('');
    lines.push(...[
      '# Admin Application (staff/admin OAuth client)',
      `PINGONE_ADMIN_CLIENT_ID=${provisioned.adminApp.clientId}`,
      `PINGONE_ADMIN_CLIENT_SECRET=${provisioned.adminApp.clientSecret || '<set-in-pingone-console>'}`,
      `PINGONE_ADMIN_REDIRECT_URI=${config.publicAppUrl}/api/auth/oauth/callback`,
      '',
      '# User Application (end-user/customer OAuth client)',
      // Use PINGONE_USER_* — the canonical name. The legacy PINGONE_CORE_*
      // names exist in configStore's fallback map but they collide with the
      // admin fallback chain (PINGONE_CORE_CLIENT_ID is listed as an admin
      // alias), so writing user IDs under that name made the BFF treat the
      // user app as the admin app and left userClientId null.
      `PINGONE_USER_CLIENT_ID=${provisioned.userApp.clientId}`,
      `PINGONE_USER_CLIENT_SECRET=${provisioned.userApp.clientSecret || '<set-in-pingone-console>'}`,
      `PINGONE_USER_REDIRECT_URI=${config.publicAppUrl}/api/auth/oauth/user/callback`,
      '',
      '# Resource Server',
      `ENDUSER_AUDIENCE=${provisioned.resourceServer.audience[0]}`,
      '',
      '# MCP Resource URIs — audiences used in Exchange #2 (RFC 8707 resource params).',
      '# Exchange #2 sends resource=mcpGateway&resource=mcpServer; PingOne only issues',
      '# aud=mcpgateway.ping.demo (exchanger has no grant on the server resource).',
      '# MCP server validates the gateway aud via MCP_SERVER_RESOURCE_URI=mcpgateway.ping.demo.',
      `MCP_RESOURCE_URI=${provisioned.mcpGwResourceServer?.audience?.[0] || 'mcpgateway.ping.demo'}`,
      `MCP_SERVER_RESOURCE_URI=${provisioned.mcpResourceServer?.audience?.[0] || 'mcpserver.ping.demo'}`,
      `PINGONE_RESOURCE_MCP_SERVER_URI=${provisioned.mcpResourceServer?.audience?.[0] || 'mcpserver.ping.demo'}`,
      '',
      '# MCP Exchanger (Token Exchange)',
      `PINGONE_TOKEN_EXCHANGER_CLIENT_ID=${provisioned.mcpExchangerApp?.clientId || ''}`,
      `PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET=${provisioned.mcpExchangerApp?.clientSecret || '<set-in-pingone-console>'}`,
      '',
      '# MCP Gateway (banking_mcp_gateway on :3005)',
      `PINGONE_MCP_GATEWAY_CLIENT_ID=${provisioned.mcpGwApp?.clientId || ''}`,
      `PINGONE_MCP_GATEWAY_CLIENT_SECRET=${provisioned.mcpGwApp?.clientSecret || '<set-in-pingone-console>'}`,
      `MCP_GW_RESOURCE_URI=${provisioned.mcpGwResourceServer?.audience?.[0] || 'mcpgateway.ping.demo'}`,
      'MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD=post',
      'MCP_GW_PASSTHROUGH_TO_MCP_SERVER=true',
      '',
      '# Agent Service (banking_agent_service on :3006)',
      `AGENT_CLIENT_ID=${provisioned.agentApp?.clientId || ''}`,
      `AGENT_CLIENT_SECRET=${provisioned.agentApp?.clientSecret || '<set-in-pingone-console>'}`,
      '',
      '# Claude Code / Cursor "pingone" MCP server OAuth client (developer tooling, not a',
      '# runtime component). NATIVE_APP, PKCE S256, no secret; redirect',
      '# http://localhost:7464/callback. install.sh patches this into .mcp.json',
      '# mcpServers.pingone.oauth.clientId so the hosted PingOne MCP server connects.',
      `PINGONE_MCP_OAUTH_CLIENT_ID=${provisioned.pingOneMcpServerApp?.clientId || ''}`,
      '',
      '# Claude Code "banking-gateway" MCP OAuth client (developer tooling). NATIVE_APP,',
      '# PKCE S256, no secret; granted MCP Gateway resource scopes so its user token has',
      '# aud=mcpgateway.ping.demo. Redirect http://localhost:7465/callback. install.sh',
      '# patches this into .mcp.json mcpServers.banking-gateway.oauth.clientId.',
      `PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID=${provisioned.bankingGatewayMcpApp?.clientId || ''}`,
      '',
      '# ─── RFC 8693 Two-Exchange Delegation ─────────────────────────────────',
      '# Exchange #1: AI Agent exchanges user token (aud=enduser.ping.demo) +',
      '#              AI Agent actor CC (aud=agentgateway.ping.demo)',
      '#              -> intermediate token (aud=agentgateway.ping.demo).',
      '# Exchange #2: MCP Exchanger exchanges intermediate token (aud=agentgateway) +',
      '#              MCP Exchanger actor CC (aud=mcpgateway.ping.demo)',
      '#              -> final MCP token (aud=mcpgateway.ping.demo).',
      `PINGONE_AI_AGENT_ACTOR_CLIENT_ID=${provisioned.aiAgentApp?.clientId || ''}`,
      `PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET=${provisioned.aiAgentApp?.clientSecret || '<set-in-pingone-console>'}`,
      `PINGONE_RESOURCE_AGENT_GATEWAY_URI=${provisioned.agentGwResourceServer?.audience?.[0] || 'agentgateway.ping.demo'}`,
      `PINGONE_RESOURCE_MCP_GATEWAY_URI=${provisioned.mcpGwResourceServer?.audience?.[0] || 'mcpgateway.ping.demo'}`,
      `# Two-Exchange Delegation audiences (Exchange #1 intermediate + Exchange #2 final)`,
      `AI_AGENT_INTERMEDIATE_AUDIENCE=${provisioned.agentGwResourceServer?.audience?.[0] || 'agentgateway.ping.demo'}`,
      `PINGONE_RESOURCE_TWO_EXCHANGE_URI=${provisioned.mcpGwResourceServer?.audience?.[0] || 'mcpgateway.ping.demo'}`,
      `# Exchange #1 scope — must match the scope granted to AI Agent on the Agent Gateway resource`,
      `TWO_EXCHANGE_INTERMEDIATE_SCOPE=agent:invoke`,
      '# Agent-to-Agent (A2A) — per-vertical specialist agents (Agent 2) + intermediate audience',
      `PINGONE_RESOURCE_A2A_INTERMEDIATE_URI=${provisioned.a2aResourceServer?.audience?.[0] || 'a2a-intermediate.ping.demo'}`,
      `A2A_INTERMEDIATE_AUDIENCE=${provisioned.a2aResourceServer?.audience?.[0] || 'a2a-intermediate.ping.demo'}`,
      `A2A_INTERMEDIATE_SCOPE=agent:invoke`,
      ...Object.values((() => { try { return require('../config/a2aSpecialists').A2A_SPECIALISTS; } catch (_e) { return {}; } })()).flatMap((spec) => {
        const app = provisioned.a2aSpecialistApps && provisioned.a2aSpecialistApps[spec.appKey];
        const key = spec.appKey.toUpperCase();
        return [
          `PINGONE_A2A_${key}_AGENT_CLIENT_ID=${app?.clientId || ''}`,
          `PINGONE_A2A_${key}_AGENT_CLIENT_SECRET=${app?.clientSecret || '<set-in-pingone-console>'}`,
        ];
      }),
      '# Admin Token Exchange',
      `ff_admin_token_exchange=true`,
      `ADMIN_TOKEN_LIFETIME=7200`,
      `ADMIN_REFRESH_TOKEN_LIFETIME=86400`,
      '',
      '# Token-endpoint auth methods — ARCHITECTURE TRUTH T-9: every PingOne',
      '# client connection uses client_secret_post. The ONLY exception is the',
      '# Worker Token CC client (type WORKER, Management API) uses CLIENT_SECRET_BASIC.',
      '# Provisioning creates every non-worker app as CLIENT_SECRET_POST.',
      `PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH=post`,
      `# Introspection identity — PingOne binds RFC 7662 introspection to the token's`,
      `# ISSUING client (or a client in the token's aud). The Worker is NOT a universal`,
      `# introspector: a Worker introspecting another client's user token gets`,
      `# active:false → "Session expired" reauth loop. So introspect AS the issuer:`,
      `#   • BFF user tokens  → PINGONE_USER_CLIENT_ID (Demo User App, client_secret_post)`,
      `#   • Gateway exchanged tokens → GW_INTROSPECTION_CLIENT_ID = MCP Exchanger (post)`,
      `# PINGONE_INTROSPECTION_AUTH_METHOD only applies to the optional dedicated`,
      `# PINGONE_INTROSPECTION_CLIENT_ID override; every non-worker app is post.`,
      `PINGONE_INTROSPECTION_AUTH_METHOD=post`,
      `PINGONE_INTROSPECTION_ENDPOINT=https://auth.pingone.${config.region}/${config.envId}/as/introspect`,
      `# JWKS must point to the AUTH host, not the Management API host (api.pingone.com)`,
      `# — the management host returns 403, breaking agent token signature verification.`,
      `PINGONE_JWKS_URI=https://auth.pingone.${config.region}/${config.envId}/as/jwks`,
      `# Gateway introspects the exchanged token (aud mcpgateway.ping.demo) AS its`,
      `# issuing client — the MCP Exchanger (client_secret_post) — NOT the Worker.`,
      `GW_INTROSPECTION_CLIENT_ID=${provisioned.mcpExchangerApp?.clientId || ''}`,
      `GW_INTROSPECTION_CLIENT_SECRET=${provisioned.mcpExchangerApp?.clientSecret || '<set-in-pingone-console>'}`,
      '',
      '# ── Authorization Server (demo_authz_server on :9001) ─────────────────────',
      '# MCP Gateway delegates ALL authorization decisions here.',
      '# Propagated to demo_mcp_gateway/.env via ensure_service_env on every run.sh start.',
      'PINGAUTHORIZE_ENDPOINT=http://localhost:9001',
      'PINGAUTHORIZE_WORKER_ID=mcp-gateway-policy',
      'MCP_GW_P1AZ_ENABLED=true',
      '',
      '# Demo Users',
      `DEMO_USER_USERNAME=demoUser`,
      `DEMO_USER_PASSWORD=${provisioned.demoUser.password}`,
      `DEMO_ADMIN_USERNAME=demoAdmin`,
      `DEMO_ADMIN_PASSWORD=${provisioned.demoAdmin.password}`,
      '',
      '# Worker Credentials (for future management)',
      `PINGONE_WORKER_CLIENT_ID=${config.workerClientId}`,
      `PINGONE_WORKER_CLIENT_SECRET=${config.workerClientSecret}`,
    ]);

    return lines.join('\n');
  }



  /**
   * Main provisioning function
   */
  async provisionEnvironment(config, onStep) {
    const steps = [];
    const provisioned = {};

    try {
      // Step 1: Initialize and validate worker credentials
      steps.push({ step: 'validate', icon: '🔐', message: 'Validating worker credentials...' });
      onStep(steps[steps.length - 1]);
      
      await this.initialize(config.envId, config.workerClientId, config.workerClientSecret, config.region);
      
      steps.push({ step: 'validate', icon: '✅', message: 'Worker credentials validated' });
      onStep(steps[steps.length - 1]);

      // Step 2: Get population ID (done in initialize)
      steps.push({ step: 'population', icon: '👥', message: `Using population: ${this.populationId}` });
      onStep(steps[steps.length - 1]);

      // Step 3: Create Resource Server
      steps.push({ step: 'resource-server', icon: '🏗️', message: 'Creating resource server...' });
      onStep(steps[steps.length - 1]);
      
      const resourceResult = await this.createResourceServer(
        _provisioningResourceName('Super Banking API'),
        'Demo API resource server for user and admin applications',
        config.audience || 'enduser.ping.demo'
      );
      
      if (resourceResult.exists) {
        steps.push({ 
          step: 'resource-server', 
          icon: '✅',
          message: 'Resource server already exists (reused)',
          resourceKey: resourceResult.resourceKey
        });
      } else {
        steps.push({ step: 'resource-server', icon: '✅', message: 'Resource server created' });
      }
      onStep(steps[steps.length - 1]);
      provisioned.resourceServer = resourceResult.resource;

      // Step 4.5: Create MCP Resource Server for Admin Operations
      steps.push({ step: 'mcp-resource-server', icon: '🔧', message: 'Creating MCP resource server for admin operations...' });
      onStep(steps[steps.length - 1]);
      
      // Args are (name, description, audience). The audience string is what
      // ends up in JWT `aud` claims and must be a stable identifier — not a
      // human description. Previously these two were swapped, causing tokens
      // minted for this resource to have aud='MCP server for admin tool…'
      // which then either failed downstream audience checks or polluted
      // .env with the description string as MCP_RESOURCE_URI.
      const mcpResourceResult = await this.createResourceServer(
        _provisioningResourceName('Super Banking MCP Server'),
        'MCP server for admin tool execution and privileged operations',
        config.mcpResourceAudience || 'mcpserver.ping.demo'
      );
      
      if (mcpResourceResult.exists) {
        steps.push({ 
          step: 'mcp-resource-server', 
          icon: '✅',
          message: 'MCP resource server already exists (reused)',
          resourceKey: mcpResourceResult.resourceKey
        });
      } else {
        steps.push({ step: 'mcp-resource-server', icon: '✅', message: 'MCP resource server created' });
      }
      onStep(steps[steps.length - 1]);
      provisioned.mcpResourceServer = mcpResourceResult.resource;

      // Step 4.6: Create MCP-specific scopes
      steps.push({ step: 'mcp-scopes', icon: '🎯', message: 'Creating MCP-specific scopes...' });
      onStep(steps[steps.length - 1]);
      
      // Derived from scope-topology.json "Super Banking MCP Server" — native
      // scope mcp:invoke plus the RFC 8693 mirrored banking/admin/users
      // scopes (T-10). Edit the manifest's resources["Super Banking MCP Server"]
      // to change this; bootstrap never hand-maintains the list.
      const mcpScopes = topologyResourceScopeObjects('Super Banking MCP Server');

      const mcpScopeResults = await this.createScopes(mcpResourceResult.resource.id, mcpScopes);
      pushScopeResultStep(steps, 'mcp-scopes', 'MCP scopes', mcpScopeResults);
      onStep(steps[steps.length - 1]);

      // Step 5: Create scopes
      steps.push({ step: 'scopes', icon: '🎯', message: 'Creating banking scopes...' });
      onStep(steps[steps.length - 1]);
      
      // NOTE: p1:read:user / p1:update:user dropped here — PingOne reserves
      // the p1:* prefix for its own scopes and rejects custom-resource
      // creation with INVALID_VALUE. Worker apps that need PingOne management
      // API access get those rights through ROLE assignments, not scope grants.
      //
      // Derived from scope-topology.json "Super Banking API" (the enduser
      // resource server). Edit the manifest to change membership; bootstrap
      // never hand-maintains this list. (Legacy accounts / admin
      // are intentionally NOT in the manifest — no tool/app references them.)
      const scopes = topologyResourceScopeObjects('Super Banking API');

      const scopeResults = await this.createScopes(resourceResult.resource.id, scopes);
      pushScopeResultStep(steps, 'scopes', 'Banking scopes', scopeResults);
      onStep(steps[steps.length - 1]);

      // Step 5: Create Admin Application
      steps.push({ step: 'admin-app', icon: '🔧', message: 'Creating admin application...' });
      onStep(steps[steps.length - 1]);
      
      const adminAppResult = await this.createApplication(
        _provisioningAppName('Super Banking Admin App'),
        'Admin OIDC login (authorization_code + PKCE). Issues admin tokens with elevated scopes. No token-exchange.',
        'WEB_APP',
        ['authorization_code', 'refresh_token']
      );
      
      pushAppResultStep(steps, 'admin-app', 'Admin application', adminAppResult);
      onStep(steps[steps.length - 1]);
      provisioned.adminApp = adminAppResult.application;
      provisioned.adminApp.clientSecret = await this.getApplicationSecret(adminAppResult.application.id);

      // Step 6: Configure Admin Application
      if (!adminAppResult.exists) {
        steps.push({ step: 'admin-config', icon: '⚙️', message: 'Configuring admin application...' });
        onStep(steps[steps.length - 1]);
        
        const _adminRedirectUris = Array.from(new Set(
          KNOWN_REDIRECT_ORIGINS.concat([config.publicAppUrl])
            .flatMap(function (o) { return [o + '/api/auth/oauth/callback', o + '/dashboard']; })
        ));
        const _adminLogoutUris = Array.from(new Set(
          KNOWN_REDIRECT_ORIGINS.concat([config.publicAppUrl])
            .map(function (o) { return o + '/logout'; })
        ));
        await this.updateApplication(adminAppResult.application.id, {
          redirectUris: _adminRedirectUris,
          // The BFF logout (routes/oauth.js) sends post_logout_redirect_uri =
          // `${getFrontendOrigin}/logout`. PingOne validates it against the
          // app's registered Signoff URLs exactly like login redirect URIs —
          // without this, logout fails "Invalid post logout redirect URI".
          postLogoutRedirectUris: _adminLogoutUris,
          pkceMethod: 'S256',
          tokenEndpointAuthMethod: 'client_secret_post',
          grantTypes: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-exchange'],
          tokenLifetime: 7200, // 2 hours for admin sessions
          refreshTokenLifetime: 86400 // 24 hours
        });
        
        steps.push({ step: 'admin-config', icon: '✅', message: 'Admin application configured with token exchange' });
        onStep(steps[steps.length - 1]);
      } else {
        // Existing admin app — refresh redirect URI AND reconcile auth method
        // AND reconcile grant types. The BFF's performTokenExchange authenticates
        // as the Admin app when calling PingOne's token-exchange endpoint
        // (oauthService.js performTokenExchange → config.clientId = admin_client_id).
        // If the Admin app is missing TOKEN_EXCHANGE in its grantTypes, PingOne
        // returns "Token exchange can only be used to issue tokens for custom
        // resources" / "Unsupported grant type" — even though the target resource
        // server IS custom. This block reconciles all three on rerun so an
        // existing app created with only ['authorization_code','refresh_token']
        // gets upgraded to the full grant set that fresh-install adds at line ~1242.
        const targetUri = `${config.publicAppUrl}/api/auth/oauth/callback`;
        const dashboardUri = `${config.publicAppUrl}/dashboard`;
        const targetLogoutUri = `${config.publicAppUrl}/logout`;
        const requiredGrants = ['AUTHORIZATION_CODE', 'REFRESH_TOKEN', 'TOKEN_EXCHANGE'];
        const currentUris = adminAppResult.application.redirectUris || [];
        const currentLogoutUris = adminAppResult.application.postLogoutRedirectUris || [];
        const currentAuthMethod = String(adminAppResult.application.tokenEndpointAuthMethod || '').toUpperCase();
        const currentGrants = new Set((adminAppResult.application.grantTypes || []).map(g => String(g).toUpperCase()));
        const needsUriUpdate = !currentUris.includes(targetUri) || !currentUris.includes(dashboardUri);
        const needsLogoutUriUpdate = !currentLogoutUris.includes(targetLogoutUri);
        const needsAuthMethodUpdate = currentAuthMethod !== 'CLIENT_SECRET_POST';
        const needsGrantsUpdate = requiredGrants.some(g => !currentGrants.has(g));
        if (needsUriUpdate || needsLogoutUriUpdate || needsAuthMethodUpdate || needsGrantsUpdate) {
          const drifts = [
            needsUriUpdate ? `redirect URI → ${targetUri}` : null,
            needsLogoutUriUpdate ? `post-logout URI → ${targetLogoutUri}` : null,
            needsAuthMethodUpdate ? `auth method (${currentAuthMethod || 'unset'} → CLIENT_SECRET_POST)` : null,
            needsGrantsUpdate ? `grants → [${requiredGrants.join(',')}]` : null,
          ].filter(Boolean).join(', ');
          steps.push({ step: 'admin-config', icon: '🔁', message: `Refreshing admin app: ${drifts}` });
          onStep(steps[steps.length - 1]);
          const patch = {};
          // Additive: keep existing URIs and add all known origins + the current targets.
          if (needsUriUpdate) {
            const allAdminUris = KNOWN_REDIRECT_ORIGINS.concat([config.publicAppUrl])
              .flatMap(function (o) { return [o + '/api/auth/oauth/callback', o + '/dashboard']; });
            patch.redirectUris = Array.from(new Set(currentUris.concat(allAdminUris)));
          }
          // Additive: keep any existing signoff URLs (e.g. legacy hosts), add canonical.
          if (needsLogoutUriUpdate) {
            const allAdminLogout = KNOWN_REDIRECT_ORIGINS.concat([config.publicAppUrl])
              .map(function (o) { return o + '/logout'; });
            patch.postLogoutRedirectUris = Array.from(new Set(currentLogoutUris.concat(allAdminLogout)));
          }
          if (needsAuthMethodUpdate) patch.tokenEndpointAuthMethod = 'client_secret_post';
          if (needsGrantsUpdate) patch.grantTypes = requiredGrants;
          await this.updateApplication(adminAppResult.application.id, patch);
          steps.push({ step: 'admin-config', icon: '✅', message: 'Admin application reconciled' });
          onStep(steps[steps.length - 1]);
        }
      }

      // Step 7: Grant scopes to Admin Application
      steps.push({ step: 'admin-grants', icon: '🔑', message: 'Granting scopes to admin application...' });
      onStep(steps[steps.length - 1]);
      
      // Grant scopes from main resource server
      const adminGrantResult = await this.grantScopesToApplication(
        adminAppResult.application.id,
        resourceResult.resource.id,
        scopes.map(s => s.name)
      );
      
      // Grant admin-specific scopes from MCP resource server
      const adminMcpGrantResult = await this.grantScopesToApplication(
        adminAppResult.application.id,
        mcpResourceResult.resource.id,
        mcpScopes.map(s => s.name)
      );
      
      pushGrantResultStep(steps, 'admin-grants', 'Admin scope grants', [adminGrantResult, adminMcpGrantResult]);
      onStep(steps[steps.length - 1]);

      // Step 8: Create User Application
      steps.push({ step: 'user-app', icon: '👤', message: 'Creating user application...' });
      onStep(steps[steps.length - 1]);
      
      const userAppResult = await this.createApplication(
        _provisioningAppName('Super Banking User App'),
        'End-user OIDC login (authorization_code + PKCE). Issues user access tokens for the BFF.',
        'WEB_APP',
        ['authorization_code', 'refresh_token']
      );
      
      pushAppResultStep(steps, 'user-app', 'User application', userAppResult);
      onStep(steps[steps.length - 1]);
      provisioned.userApp = userAppResult.application;
      provisioned.userApp.clientSecret = await this.getApplicationSecret(userAppResult.application.id);

      // Step 9: Configure User Application
      // The end-user OAuth callback uses /api/auth/oauth/USER/callback so the
      // BFF can distinguish admin vs user sign-ins. (The admin app uses the
      // un-suffixed /api/auth/oauth/callback). Mismatching this caused PingOne
      // to reject the callback and the SPA to redirect to /config?error.
      const userRedirectUri = `${config.publicAppUrl}/api/auth/oauth/user/callback`;
      const userLogoutUri = `${config.publicAppUrl}/logout`;
      if (!userAppResult.exists) {
        steps.push({ step: 'user-config', icon: '⚙️', message: 'Configuring user application...' });
        onStep(steps[steps.length - 1]);

        const _userRedirectUris = Array.from(new Set(
          KNOWN_REDIRECT_ORIGINS.concat([config.publicAppUrl])
            .flatMap(function (o) { return [o + '/api/auth/oauth/user/callback', o + '/dashboard']; })
        ));
        const _userLogoutUris = Array.from(new Set(
          KNOWN_REDIRECT_ORIGINS.concat([config.publicAppUrl])
            .map(function (o) { return o + '/logout'; })
        ));
        await this.updateApplication(userAppResult.application.id, {
          redirectUris: _userRedirectUris,
          // BFF logout (routes/oauthUser.js) sends post_logout_redirect_uri =
          // `${getFrontendOrigin}/logout`; PingOne validates it against the
          // app's Signoff URLs or logout fails "Invalid post logout redirect URI".
          postLogoutRedirectUris: _userLogoutUris,
          pkceMethod: 'S256',
          tokenEndpointAuthMethod: 'client_secret_post'
        });

        steps.push({ step: 'user-config', icon: '✅', message: 'User application configured' });
        onStep(steps[steps.length - 1]);
      } else {
        // Existing user app — refresh redirect URI AND reconcile auth method.
        // The BFF's oauthUserService.exchangeCodeForToken sends client_id/client_secret
        // in the body (client_secret_post style). If the existing app's auth method
        // drifted to CLIENT_SECRET_BASIC (PingOne's default), token exchange fails with
        // "invalid_client — Unsupported authentication method" and the user can't log in.
        // Reconciling auth method on idempotent reruns prevents this.
        const currentUris = userAppResult.application.redirectUris || [];
        const currentLogoutUris = userAppResult.application.postLogoutRedirectUris || [];
        const currentAuthMethod = String(userAppResult.application.tokenEndpointAuthMethod || '').toUpperCase();
        const userDashboardUri = `${config.publicAppUrl}/dashboard`;
        const needsUriUpdate = !currentUris.includes(userRedirectUri) || !currentUris.includes(userDashboardUri);
        const needsLogoutUriUpdate = !currentLogoutUris.includes(userLogoutUri);
        const needsAuthMethodUpdate = currentAuthMethod !== 'CLIENT_SECRET_POST';
        if (needsUriUpdate || needsLogoutUriUpdate || needsAuthMethodUpdate) {
          const drifts = [
            needsUriUpdate ? 'redirect URI' : null,
            needsLogoutUriUpdate ? `post-logout URI → ${userLogoutUri}` : null,
            needsAuthMethodUpdate ? `auth method (${currentAuthMethod || 'unset'} → CLIENT_SECRET_POST)` : null,
          ].filter(Boolean).join(', ');
          steps.push({ step: 'user-config', icon: '🔁', message: `Refreshing user app: ${drifts}` });
          onStep(steps[steps.length - 1]);
          const patch = {};
          // Additive: keep existing URIs and add all known origins + the current targets.
          if (needsUriUpdate) {
            const allUserUris = KNOWN_REDIRECT_ORIGINS.concat([config.publicAppUrl])
              .flatMap(function (o) { return [o + '/api/auth/oauth/user/callback', o + '/dashboard']; });
            patch.redirectUris = Array.from(new Set(currentUris.concat(allUserUris)));
          }
          // Additive: preserve existing signoff URLs, add canonical.
          if (needsLogoutUriUpdate) {
            const allUserLogout = KNOWN_REDIRECT_ORIGINS.concat([config.publicAppUrl])
              .map(function (o) { return o + '/logout'; });
            patch.postLogoutRedirectUris = Array.from(new Set(currentLogoutUris.concat(allUserLogout)));
          }
          if (needsAuthMethodUpdate) patch.tokenEndpointAuthMethod = 'client_secret_post';
          await this.updateApplication(userAppResult.application.id, patch);
          steps.push({ step: 'user-config', icon: '✅', message: 'User application reconciled' });
          onStep(steps[steps.length - 1]);
        }
      }

      // Step 10: Grant scopes to User Application
      steps.push({ step: 'user-grants', icon: '🔑', message: 'Granting scopes to user application...' });
      onStep(steps[steps.length - 1]);
      
      const userGrantResult = await this.grantScopesToApplication(
        userAppResult.application.id,
        resourceResult.resource.id,
        // SoT: scope-topology.json apps["Super Banking User App"].grantedScopes.
        // Derived, not hardcoded — a new vertical's featureScope is picked up
        // automatically once it is in the topology (no edit needed here).
        topologyAppGrantedScopes('Super Banking User App')
      );
      
      pushGrantResultStep(steps, 'user-grants', 'User scope grants', userGrantResult);
      onStep(steps[steps.length - 1]);

      // Step 10.5: Ensure permissive demo password policy is bound to the
      // default population BEFORE we create users — otherwise the very first
      // user creation has to satisfy PingOne's Standard policy (history of 6
      // entries, requires upper+lower+digit+special, etc).
      steps.push({ step: 'password-policy', icon: '🔧', message: 'Ensuring permissive demo password policy...' });
      onStep(steps[steps.length - 1]);
      try {
        const policyId = await this._ensurePasswordPolicy(
          'Demo Password Policy',
          'Demo-friendly: 8-char minimum, no character classes, no commonly-used check, no history beyond PingOne floor.'
        );
        await this._bindPopulationPolicy(this.populationId, policyId);
        steps.push({ step: 'password-policy', icon: '✅', message: 'Demo password policy bound to default population' });
      } catch (polErr) {
        steps.push({ step: 'password-policy', icon: '⚠️', message: `Password policy step: ${polErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 11: Create demo user demoUser
      steps.push({ step: 'demoUser', icon: '👨', message: 'Creating demo user: demoUser...' });
      onStep(steps[steps.length - 1]);
      
      const bankUserResult = await this.createUser(
        'demoUser',
        'Demo',
        'User',
        `demoUser@${demoEmailDomain(config.publicAppUrl)}`
      );
      
      if (bankUserResult.exists) {
        steps.push({ 
          step: 'demoUser', 
          icon: '✅',
          message: 'User demoUser already exists (reused)',
          resourceKey: bankUserResult.resourceKey
        });
      } else {
        steps.push({ step: 'demoUser', icon: '✅', message: 'User demoUser created' });
      }
      onStep(steps[steps.length - 1]);

      // Step 12: Set demoUser password — always run, even on rerun, so the
      // documented demo password is guaranteed to work even after manual
      // PingOne admin changes or older partial-runs that wrote a different one.
      {
        const bankUserPassword = DEMO_PASSWORD;
        steps.push({ step: 'demoUser-password', icon: '🔒', message: 'Setting demoUser password...' });
        onStep(steps[steps.length - 1]);
        try {
          const r = await this.setUserPassword(bankUserResult.user.id, bankUserPassword);
          if (r.changed === false && r.skipped === 'password_policy_history') {
            steps.push({ step: 'demoUser-password', icon: '✅', message: `DemoUser password unchanged (already '${bankUserPassword}')` });
          } else {
            steps.push({ step: 'demoUser-password', icon: '✅', message: `DemoUser password set to '${bankUserPassword}'` });
          }
        } catch (err) {
          steps.push({ step: 'demoUser-password', icon: '⚠️', message: `Password set failed (continuing): ${err.message}` });
        }
        provisioned.demoUser = { ...bankUserResult.user, password: bankUserPassword };
        onStep(steps[steps.length - 1]);
      }

      // Step 13: Create demo user demoAdmin
      steps.push({ step: 'demoAdmin', icon: '👨‍💼', message: 'Creating demo user: demoAdmin...' });
      onStep(steps[steps.length - 1]);
      
      const bankAdminResult = await this.createUser(
        'demoAdmin',
        'Demo',
        'Admin',
        `demoAdmin@${demoEmailDomain(config.publicAppUrl)}`
      );
      
      if (bankAdminResult.exists) {
        steps.push({ 
          step: 'demoAdmin', 
          icon: '✅',
          message: 'User demoAdmin already exists (reused)',
          resourceKey: bankAdminResult.resourceKey
        });
      } else {
        steps.push({ step: 'demoAdmin', icon: '✅', message: 'User demoAdmin created' });
      }
      onStep(steps[steps.length - 1]);

      // Step 14: Set demoAdmin password — always run (see demoUser step above).
      {
        const bankAdminPassword = DEMO_PASSWORD;
        steps.push({ step: 'demoAdmin-password', icon: '🔒', message: 'Setting demoAdmin password...' });
        onStep(steps[steps.length - 1]);
        try {
          const r = await this.setUserPassword(bankAdminResult.user.id, bankAdminPassword);
          if (r.changed === false && r.skipped === 'password_policy_history') {
            steps.push({ step: 'demoAdmin-password', icon: '✅', message: `DemoAdmin password unchanged (already '${bankAdminPassword}')` });
          } else {
            steps.push({ step: 'demoAdmin-password', icon: '✅', message: `DemoAdmin password set to '${bankAdminPassword}'` });
          }
        } catch (err) {
          steps.push({ step: 'demoAdmin-password', icon: '⚠️', message: `Password set failed (continuing): ${err.message}` });
        }
        provisioned.demoAdmin = { ...bankAdminResult.user, password: bankAdminPassword };
        onStep(steps[steps.length - 1]);
      }

      // Step 14.4: Grant PingOne admin roles to demoUser + demoAdmin so
      // interactive Management-API logins (pingone-admin MCP server, admin
      // console) are never denied with "no role assignments" after a
      // provision/reseed. Idempotent; non-fatal.
      steps.push({ step: 'demo-roles', icon: '🛡️', message: 'Assigning admin roles to demoUser/demoAdmin...' });
      onStep(steps[steps.length - 1]);
      try {
        const summaries = [];
        for (const [label, u] of [['demoUser', bankUserResult.user], ['demoAdmin', bankAdminResult.user]]) {
          const r = await this._ensureAdminRoleAssignments(u.id);
          const failNote = r.failed.length ? `, ${r.failed.length} FAILED` : '';
          summaries.push(`${label}: ${r.assigned.length} new, ${r.existing.length} existing${failNote}`);
        }
        steps.push({ step: 'demo-roles', icon: '✅', message: `Admin roles ensured (${summaries.join('; ')})` });
      } catch (roleErr) {
        steps.push({ step: 'demo-roles', icon: '⚠️', message: `Role assignment failed (continuing): ${roleErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 14.5: Create demo user demoDelegate + delegation markers.
      // Three artifacts wire delegation:
      //   - User attribute `isDelegate` = "true" (CUSTOM STRING; PingOne user
      //     attributes can't be BOOLEAN, so we store the string "true"/"false").
      //   - Group `BankDelegates` membership.
      //   - Token claim `is_delegate` emitted on the Super Banking API resource
      //     via SPEL value `${user.isDelegate}`. Apps that want delegation
      //     status read it from the access token without an extra API call.
      steps.push({ step: 'demoDelegate', icon: '🤝', message: 'Creating demo user: demoDelegate...' });
      onStep(steps[steps.length - 1]);

      const bankDelegateResult = await this.createUser(
        'demoDelegate',
        'Demo',
        'Delegate',
        `demoDelegate@${demoEmailDomain(config.publicAppUrl)}`
      );
      if (bankDelegateResult.exists) {
        steps.push({ step: 'demoDelegate', icon: '✅', message: 'User demoDelegate already exists (reused)', resourceKey: bankDelegateResult.resourceKey });
      } else {
        steps.push({ step: 'demoDelegate', icon: '✅', message: 'User demoDelegate created' });
      }
      onStep(steps[steps.length - 1]);

      // Set password (always)
      steps.push({ step: 'demoDelegate-password', icon: '🔒', message: 'Setting demoDelegate password...' });
      onStep(steps[steps.length - 1]);
      try {
        const r = await this.setUserPassword(bankDelegateResult.user.id, DEMO_PASSWORD);
        if (r.changed === false && r.skipped === 'password_policy_history') {
          steps.push({ step: 'demoDelegate-password', icon: '✅', message: `demoDelegate password unchanged (already '${DEMO_PASSWORD}')` });
        } else {
          steps.push({ step: 'demoDelegate-password', icon: '✅', message: `demoDelegate password set to '${DEMO_PASSWORD}'` });
        }
      } catch (err) {
        steps.push({ step: 'demoDelegate-password', icon: '⚠️', message: `Password set failed (continuing): ${err.message}` });
      }
      provisioned.demoDelegate = { ...bankDelegateResult.user, password: DEMO_PASSWORD };
      onStep(steps[steps.length - 1]);

      // Ensure the isDelegate user-schema attribute exists (CUSTOM STRING).
      steps.push({ step: 'isDelegate-schema', icon: '🔧', message: 'Ensuring isDelegate user attribute...' });
      onStep(steps[steps.length - 1]);
      try {
        await this._ensureUserSchemaAttribute('isDelegate', 'STRING', 'Is delegate user');
        steps.push({ step: 'isDelegate-schema', icon: '✅', message: 'isDelegate user attribute present' });
      } catch (err) {
        steps.push({ step: 'isDelegate-schema', icon: '⚠️', message: `isDelegate attribute step: ${err.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Set isDelegate=true on demoDelegate (PATCH user). Uses partial-update
      // semantics — we only send the changed field.
      try {
        await this.makeRequest('PATCH', `/users/${bankDelegateResult.user.id}`, { isDelegate: 'true' });
        steps.push({ step: 'demoDelegate-flag', icon: '✅', message: 'demoDelegate.isDelegate = true' });
      } catch (err) {
        steps.push({ step: 'demoDelegate-flag', icon: '⚠️', message: `Could not set isDelegate flag: ${err.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Ensure the `mayAct` user-schema attribute exists (CUSTOM JSON). This holds
      // the RFC 8693 delegation declaration on the USER record: { "sub": "<actor>" }.
      // Provisioning no longer writes per-user values or token projections for it;
      // the attribute is kept so the agent-authorization and delegation features
      // (which write it at runtime) work on a fresh environment.
      steps.push({ step: 'mayAct-schema', icon: '🔧', message: 'Ensuring mayAct user attribute (JSON)...' });
      onStep(steps[steps.length - 1]);
      try {
        // displayName: letters/digits/spaces only — PingOne rejects parens/punctuation
        // with INVALID_DATA ("displayName must contain only Unicode letters ...").
        await this._ensureUserSchemaAttribute('mayAct', 'JSON', 'RFC 8693 may act delegation');
        steps.push({ step: 'mayAct-schema', icon: '✅', message: 'mayAct user attribute present (JSON)' });
      } catch (err) {
        steps.push({ step: 'mayAct-schema', icon: '⚠️', message: `mayAct attribute step: ${err.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Ensure the `delegatedTo` user-schema attribute (CUSTOM JSON ARRAY). Holds the
      // family-delegation declaration on the USER record: ["<delegate sub>", ...].
      // JSON (not STRING) so the resource projection `${user.delegatedTo}` emits a real
      // JSON array. Synced from active delegation records on grant/revoke (Part C).
      steps.push({ step: 'delegatedTo-schema', icon: '🔧', message: 'Ensuring delegatedTo user attribute (JSON)...' });
      onStep(steps[steps.length - 1]);
      try {
        await this._ensureUserSchemaAttribute('delegatedTo', 'JSON', 'Family delegation delegate subs');
        steps.push({ step: 'delegatedTo-schema', icon: '✅', message: 'delegatedTo user attribute present (JSON)' });
      } catch (delSchemaErr) {
        steps.push({ step: 'delegatedTo-schema', icon: '⚠️', message: `delegatedTo attribute step: ${delSchemaErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Create BankDelegates group + add demoDelegate as member (idempotent).
      steps.push({ step: 'bankDelegates-group', icon: '👥', message: 'Ensuring BankDelegates group...' });
      onStep(steps[steps.length - 1]);
      try {
        const groupId = await this._ensureGroup('BankDelegates', 'Users authorized as delegated agents (demo)');
        await this._ensureUserInGroup(bankDelegateResult.user.id, groupId);
        steps.push({ step: 'bankDelegates-group', icon: '✅', message: 'demoDelegate added to BankDelegates group' });
      } catch (err) {
        steps.push({ step: 'bankDelegates-group', icon: '⚠️', message: `Group step: ${err.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Scenario 1 (Denied Access — user not in group): create the PrivilegedBanking
      // group and add demoUser + demoAdmin. demoDelegate is intentionally left OUT
      // so it triggers the group-deny demo on a restricted tool. Membership must
      // match config/group-policy.json (the simulated engine's source of truth) so
      // simulated and live PingOne decisions agree. Idempotent.
      steps.push({ step: 'privilegedBanking-group', icon: '👥', message: 'Ensuring PrivilegedBanking group...' });
      onStep(steps[steps.length - 1]);
      try {
        const groupId = await this._ensureGroup('PrivilegedBanking', 'Users permitted to view sensitive banking data (demo, Scenario 1)');
        if (bankUserResult?.user?.id) await this._ensureUserInGroup(bankUserResult.user.id, groupId);
        if (bankAdminResult?.user?.id) await this._ensureUserInGroup(bankAdminResult.user.id, groupId);
        steps.push({ step: 'privilegedBanking-group', icon: '✅', message: 'demoUser + demoAdmin added to PrivilegedBanking (demoDelegate excluded)' });
      } catch (err) {
        steps.push({ step: 'privilegedBanking-group', icon: '⚠️', message: `Group step: ${err.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 15: Create MCP Server Application
      steps.push({ step: 'mcp-app', icon: '🤖', message: 'Creating MCP Server application...' });
      onStep(steps[steps.length - 1]);
      
      // App-type truth: only "Super Banking Worker Token" may be type WORKER.
      // The MCP Server app introspects gateway-exchanged tokens
      // (aud=mcp-server) via RFC 7662. PingOne forbids resource-scope grants
      // on WORKER apps (see grantScopesToApplication), so a WORKER MCP Server
      // app silently has zero grants and PingOne returns active:false for
      // every introspection — breaking every gateway->MCP tool call. Must be
      // WEB_APP/client_credentials so it can hold the grant on the MCP Server
      // resource. See REGRESSION_PLAN §4.
      const mcpAppResult = await this.createApplication(
        _provisioningAppName('Super Banking MCP Server'),
        'Client identity for the MCP server process. Client credentials only — not a resource server. Renamed from Demo MCP Server to avoid collision with the Demo MCP Server resource.',
        'WEB_APP',
        ['client_credentials']
      );
      
      pushAppResultStep(steps, 'mcp-app', 'MCP Server application', mcpAppResult);
      onStep(steps[steps.length - 1]);
      provisioned.mcpApp = mcpAppResult.application;
      provisioned.mcpApp.clientSecret = await this.getApplicationSecret(mcpAppResult.application.id);

      // Step 16: Configure MCP Server Application
      if (!mcpAppResult.exists) {
        steps.push({ step: 'mcp-config', icon: '⚙️', message: 'Configuring MCP Server application...' });
        onStep(steps[steps.length - 1]);
        
        await this.updateApplication(mcpAppResult.application.id, {
          tokenEndpointAuthMethod: 'client_secret_post'
        });
        
        steps.push({ step: 'mcp-config', icon: '✅', message: 'MCP Server application configured' });
        onStep(steps[steps.length - 1]);
      }

      // Step 17: Grant scopes to MCP Server Application
      steps.push({ step: 'mcp-grants', icon: '🔑', message: 'Granting scopes to MCP Server application...' });
      onStep(steps[steps.length - 1]);
      
      // Grant scopes for client credentials (Step 6 in documentation).
      // MCP Server is the token-exchange CLIENT — it needs every scope it
      // might re-request during exchange. Phase 267 adds mortgage:read
      // for the Path A (api-key disposition) flow.
      //
      // mcp:invoke is defined ONLY on the MCP Server resource (mcpResourceResult),
      // NOT on the Banking API/enduser resource (resourceResult). Granting it on
      // the enduser resource causes it to land in missingScopes (silently dropped).
      // Two separate grants are required: enduser scopes on the Banking API resource,
      // and mcp:invoke on the MCP Server resource. See REGRESSION_PLAN §4.
      const [mcpAppGrantResult, mcpAppMcpInvokeGrantResult] = await Promise.all([
        this.grantScopesToApplication(
          mcpAppResult.application.id,
          resourceResult.resource.id,
          ['read', 'ai:agent:read', 'mortgage:read']
        ),
        this.grantScopesToApplication(
          mcpAppResult.application.id,
          mcpResourceResult.resource.id,
          ['mcp:invoke']
        ),
      ]);

      pushGrantResultStep(steps, 'mcp-grants', 'MCP Server scope grants', [mcpAppGrantResult, mcpAppMcpInvokeGrantResult]);
      onStep(steps[steps.length - 1]);

      // Step 18: Worker app — reuse the bootstrap credentials (no separate app created).
      // The bootstrap worker app entered by the user IS the worker; its client ID/secret
      // are written to .env as PINGONE_WORKER_CLIENT_ID/SECRET. Creating a second app
      // here would produce a duplicate with no role assignment.
      steps.push({ step: 'worker-app', icon: '✅', message: 'Worker application — using bootstrap credentials (no duplicate created)' });
      onStep(steps[steps.length - 1]);

      // Step 22: Ensure bankingPrincipalUserId user-schema attribute exists.
      // Uses the idempotent _ensureUserSchemaAttribute helper — checks first
      // and only POSTs if absent, so reruns stop reporting INVALID_DATA.
      steps.push({ step: 'schema-attr', icon: '🔧', message: 'Ensuring bankingPrincipalUserId user attribute...' });
      onStep(steps[steps.length - 1]);
      try {
        await this._ensureUserSchemaAttribute('bankingPrincipalUserId', 'STRING', 'Principal User ID');
        steps.push({ step: 'schema-attr', icon: '✅', message: 'bankingPrincipalUserId user attribute present' });
      } catch (schemaErr) {
        steps.push({ step: 'schema-attr', icon: '⚠️', message: `Schema attribute step: ${schemaErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 23: Create MCP Exchanger application.
      //
      // App type is WEB_APP (NOT WORKER). The 2026-05-13 token-flow audit
      // (docs/token-flow-audit.md) and the live PingOne spike test confirmed:
      // WORKER-type apps silently bind their client_credentials tokens to
      // aud=["https://api.pingone.com"] (the Mgmt API resource), ignoring the
      // `audience` parameter on the request. When that worker-aud token is
      // used as actor_token in an RFC 8693 exchange, PingOne refuses with
      // "Token exchange can only be used to issue tokens for custom resources"
      // (the error applies to the ACTOR's aud, not the target).
      //
      // WEB_APP with client_credentials + token_exchange grants + a scope
      // grant on a custom resource produces a CC token bound to that custom
      // audience. The redirect URI is a placeholder — required by PingOne
      // for any WEB_APP, never actually used because we don't run the
      // authorization_code flow from this app.
      let mcpExchangerResult;
      steps.push({ step: 'mcp-exchanger-app', icon: '🔧', message: 'Creating MCP Exchanger application...' });
      onStep(steps[steps.length - 1]);
      mcpExchangerResult = await this.createApplication(
        _provisioningAppName('Super Banking MCP Exchanger'),
        'RFC 8693 actor identity for BFF→gateway token exchange (Step 2). Mints tokens scoped to mcpgateway audience. NOT a WORKER — see docs/token-flow-audit.md.',
        'WEB_APP',
        ['authorization_code', 'client_credentials', 'token_exchange']
      );
      provisioned.mcpExchangerApp = mcpExchangerResult.application;
      provisioned.mcpExchangerApp.clientSecret = await this.getApplicationSecret(mcpExchangerResult.application.id);
      pushAppResultStep(steps, 'mcp-exchanger-app', 'MCP Exchanger application', mcpExchangerResult);
      onStep(steps[steps.length - 1]);

      // Step 23a: Configure MCP Exchanger redirect URI + auth method.
      // WEB_APP requires redirectUris on create; we set a placeholder because
      // this app never actually runs the authorization_code redirect flow —
      // it's only used for CC + token-exchange. tokenEndpointAuthMethod is
      // CLIENT_SECRET_POST per ARCHITECTURE TRUTH T-9 (every non-worker
      // PingOne client uses client_secret_post; only the Worker CC app is
      // basic). The BFF code defaults match (agentMcpTokenService.js,
      // oauthService.js MCP-exchanger CC mint).
      if (!mcpExchangerResult.exists) {
        // T-9: non-worker app (CC + RFC 8693 token exchange) → client_secret_post.
        await this.updateApplication(mcpExchangerResult.application.id, {
          redirectUris: [`${config.publicAppUrl}/api/auth/oauth/mcp-exchanger-placeholder-callback`],
          tokenEndpointAuthMethod: 'client_secret_post',
        });
      }

      // Step 23.5: Wire `may_act` claim as a resource attribute, SOURCED FROM THE
      // USER RECORD. The user's `mayAct` custom attribute (JSON) declares who may
      // act on their behalf; the resource simply projects it into the access token.
      //
      // ⚠️ PingOne resource custom-attribute evaluation (verified empirically,
      // 2026-06-03): the `${...}` attribute-substitution form IS evaluated and a
      // JSON-typed user attribute (`mayAct`) is emitted as a real JSON OBJECT.
      // The `#{...}` SpEL form is NOT evaluated here — it is emitted VERBATIM as a
      // literal string, which breaks `may_act.sub` lookups (was the prior bug:
      // tokens carried may_act = the literal text "#{'sub':'...'}"). So we MUST use
      // `${user.mayAct}`, never `#{...}`, and the per-user value lives on the user
      // record — written at runtime by the agent-authorization grant/revoke routes
      // (provisioning no longer sets per-user values; an unset attribute projects
      // no claim, so a fresh environment starts with the agent unauthorized).
      // See memory: pingone_may_act_user_attribute.
      const MAY_ACT_USER_SPEL = '${user.mayAct}';
      steps.push({ step: 'may-act-claim', icon: '🔧', message: 'Wiring may_act token claim ← user.mayAct (JSON object)...' });
      onStep(steps[steps.length - 1]);
      try {
        await this._setResourceAttribute(
          provisioned.resourceServer.id,
          'may_act',
          MAY_ACT_USER_SPEL
        );
        // Same projection on the MCP resource so MCP-audience user tokens also
        // carry the delegation declaration.
        if (provisioned.mcpResourceServer?.id) {
          await this._setResourceAttribute(
            provisioned.mcpResourceServer.id,
            'may_act',
            MAY_ACT_USER_SPEL
          );
        }
        steps.push({ step: 'may-act-claim', icon: '✅', message: 'may_act claim wired ← ${user.mayAct} (emits JSON object)' });
      } catch (mayActErr) {
        steps.push({ step: 'may-act-claim', icon: '⚠️', message: `may_act claim step: ${mayActErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 23.5c: Wire `delegated_to` token claim ← user.delegatedTo (JSON array).
      // Family delegation (user→user), surfaced as its own token-chain lane — kept
      // SEPARATE from the agent's may_act. Same `${user.X}` projection rule (JSON-typed
      // attribute → real JSON array; NEVER `#{...}`, which is emitted verbatim). The
      // per-user value is synced from active delegation records on grant/revoke.
      const DELEGATED_TO_USER_SPEL = '${user.delegatedTo}';
      steps.push({ step: 'delegated-to-claim', icon: '🔧', message: 'Wiring delegated_to token claim ← user.delegatedTo (JSON array)...' });
      onStep(steps[steps.length - 1]);
      try {
        await this._setResourceAttribute(provisioned.resourceServer.id, 'delegated_to', DELEGATED_TO_USER_SPEL);
        if (provisioned.mcpResourceServer?.id) {
          await this._setResourceAttribute(provisioned.mcpResourceServer.id, 'delegated_to', DELEGATED_TO_USER_SPEL);
        }
        steps.push({ step: 'delegated-to-claim', icon: '✅', message: 'delegated_to claim wired ← ${user.delegatedTo} (emits JSON array)' });
      } catch (delToErr) {
        steps.push({ step: 'delegated-to-claim', icon: '⚠️', message: `delegated_to claim step: ${delToErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 23.6: Wire `is_delegate` token claim. SPEL `${user.isDelegate}`
      // resolves at token-issue time to the user's stored attribute, so apps
      // can read delegation status from the access token without an extra
      // /v1/users API call. demoDelegate has isDelegate="true"; demoUser/
      // demoAdmin don't, so the claim is empty/false for them.
      steps.push({ step: 'is-delegate-claim', icon: '🔧', message: 'Wiring is_delegate token claim → ${user.isDelegate}...' });
      onStep(steps[steps.length - 1]);
      try {
        await this._setResourceAttribute(
          provisioned.resourceServer.id,
          'is_delegate',
          '${user.isDelegate}'
        );
        steps.push({ step: 'is-delegate-claim', icon: '✅', message: 'is_delegate claim wired (SPEL = ${user.isDelegate})' });
      } catch (delErr) {
        steps.push({ step: 'is-delegate-claim', icon: '⚠️', message: `is_delegate claim step: ${delErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // agentRestrictions schema attribute (always provisioned regardless of ff_agent_restrictions)
      steps.push({ step: 'agentRestrictions-schema', icon: '·', message: 'Ensuring agentRestrictions user schema attribute...' });
      onStep(steps[steps.length - 1]);
      try {
        await this._ensureUserSchemaAttribute('agentRestrictions', 'STRING', 'Agent Restrictions');
        steps.push({ step: 'agentRestrictions-schema', icon: '✅', message: 'agentRestrictions attribute → created (or already exists)' });
      } catch (err) {
        steps.push({ step: 'agentRestrictions-schema', icon: '⚠️', message: `agentRestrictions schema attribute failed: ${err.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Set agentRestrictions default on demoUser
      if (provisioned.demoUser?.id) {
        steps.push({ step: 'agentRestrictions-user', icon: '·', message: 'Setting agentRestrictions default on demo user...' });
        onStep(steps[steps.length - 1]);
        try {
          await this.makeRequest('PATCH', `/users/${provisioned.demoUser.id}`, { agentRestrictions: 'write' });
          steps.push({ step: 'agentRestrictions-user', icon: '✅', message: 'agentRestrictions: demo user → write' });
        } catch (err) {
          steps.push({ step: 'agentRestrictions-user', icon: '⚠️', message: `agentRestrictions: demo user set failed (non-fatal): ${err.message}` });
        }
        onStep(steps[steps.length - 1]);
      }

      // Set agentRestrictions default on demoAdmin
      if (provisioned.demoAdmin?.id) {
        steps.push({ step: 'agentRestrictions-admin', icon: '·', message: 'Setting agentRestrictions default on demo admin...' });
        onStep(steps[steps.length - 1]);
        try {
          await this.makeRequest('PATCH', `/users/${provisioned.demoAdmin.id}`, { agentRestrictions: 'write' });
          steps.push({ step: 'agentRestrictions-admin', icon: '✅', message: 'agentRestrictions: demo admin → write' });
        } catch (err) {
          steps.push({ step: 'agentRestrictions-admin', icon: '⚠️', message: `agentRestrictions: demo admin set failed (non-fatal): ${err.message}` });
        }
        onStep(steps[steps.length - 1]);
      }

      // Step 24: Add bankingPrincipalUserId SPEL token claim on user app
      steps.push({ step: 'spel-claim', icon: '🔧', message: 'Adding SPEL token claim on User application...' });
      onStep(steps[steps.length - 1]);
      try {
        await this.enableTokenCustomization(userAppResult.application.id);
        await this.addTokenClaim(
          userAppResult.application.id,
          'bankingPrincipalUserId',
          'EXPRESSION',
          "${user.bankingPrincipalUserId}"
        );
        steps.push({ step: 'spel-claim', icon: '✅', message: 'bankingPrincipalUserId SPEL claim added' });
      } catch (spelErr) {
        steps.push({ step: 'spel-claim', icon: '⚠️', message: `SPEL claim step: ${spelErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 25: Create MCP Gateway resource server
      // Inbound tokens to the gateway carry aud = MCP_GW_RESOURCE_URI; the gateway re-exchanges
      // them for backend-MCP audiences. See banking_mcp_gateway/src/config.ts.
      steps.push({ step: 'mcp-gw-resource', icon: '🛡️', message: 'Creating MCP Gateway resource server...' });
      onStep(steps[steps.length - 1]);
      const mcpGwAudience = config.mcpGatewayAudience || 'mcpgateway.ping.demo';
      const mcpGwResourceResult = await this.createResourceServer(
        _provisioningResourceName('Super Banking MCP Gateway'),
        'Inbound resource server for the MCP Gateway (aud target for delegated tokens)',
        mcpGwAudience
      );
      if (mcpGwResourceResult.exists) {
        steps.push({ step: 'mcp-gw-resource', icon: '✅', message: 'MCP Gateway resource server already exists (reused)', resourceKey: mcpGwResourceResult.resourceKey });
      } else {
        steps.push({ step: 'mcp-gw-resource', icon: '✅', message: 'MCP Gateway resource server created' });
      }
      onStep(steps[steps.length - 1]);
      provisioned.mcpGwResourceServer = mcpGwResourceResult.resource;

      // Step 26: Create MCP Gateway scopes.
      //
      // mcp:invoke is the gateway's own scope. The * tool
      // scopes MUST also be mirrored here: the BFF's RFC 8693 exchange #1
      // audiences the user token to THIS resource (resolveExchangeAudience →
      // pingone_resource_mcp_gateway_uri), and the gateway gates inbound
      // requests on the per-tool required scopes derived from
      // scope-topology.json (getScopesForGatewayTool: read /
      // write / transfer / mortgage:read). Per
      // ARCHITECTURE-TRUTHS T-10, scope vocabularies are per-resource and do
      // NOT cascade — a scope that travels through an exchange hop must exist
      // on that hop's audience resource or PingOne silently drops it and the
      // gateway then denies with insufficient_scope. Mirror exactly the
      // gateway-surface tool scopes (same pattern already used for the MCP
      // Server and Two-Exchange resources).
      steps.push({ step: 'mcp-gw-scopes', icon: '🎯', message: 'Creating MCP Gateway scopes...' });
      onStep(steps[steps.length - 1]);
      // Derived from scope-topology.json "Super Banking MCP Gateway": native
      // mcp:invoke + the RFC 8693 mirroredScopes (read /
      // write / transfer / mortgage:read). The mirror
      // is mandatory — see the manifest's servers.banking_mcp_gateway note and
      // ARCHITECTURE-TRUTHS T-10. Edit the manifest, not this list.
      const mcpGwScopes = topologyResourceScopeObjects('Super Banking MCP Gateway');
      const mcpGwScopeResults = await this.createScopes(mcpGwResourceResult.resource.id, mcpGwScopes);
      pushScopeResultStep(steps, 'mcp-gw-scopes', 'MCP Gateway scopes', mcpGwScopeResults);
      onStep(steps[steps.length - 1]);

      // Step 27: Create MCP Gateway application (for re-exchange to backend MCP servers).
      // banking_mcp_gateway requires PINGONE_MCP_GATEWAY_CLIENT_ID / PINGONE_MCP_GATEWAY_CLIENT_SECRET; without them
      // the service exits at startup. Token-exchange grant is needed because the gateway
      // re-exchanges incoming user tokens for backend-aud-narrowed tokens.
      //
      // MUST be WEB_APP, NOT WORKER. The gateway is an RFC 8693 participant
      // (exchange #2: mcp-gw token -> mcp-server aud) with exactly the same
      // role as the MCP Exchanger (which is documented "NOT a WORKER"). PingOne
      // forbids resource access grants on WORKER apps, so grantScopesToApplication
      // silently no-ops on a WORKER — leaving the gateway client with zero
      // resource grants and PingOne refusing its token-exchange with
      // "Token exchange can only be used to issue tokens for custom resources".
      // WORKER is for the PingOne Management API only (Super Banking Worker
      // Token), never for the AI / token-exchange flow.
      steps.push({ step: 'mcp-gw-app', icon: '🚪', message: 'Creating MCP Gateway application...' });
      onStep(steps[steps.length - 1]);
      const mcpGwAppResult = await this.createApplication(
        _provisioningAppName('Super Banking MCP Gateway'),
        'RFC 8693 re-exchange actor for gateway→backend hop (Step 3). Mints tokens scoped to mcpserver audience. NOT a WORKER — WORKER apps cannot hold resource grants.',
        'WEB_APP',
        ['client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange']
      );
      provisioned.mcpGwApp = mcpGwAppResult.application;
      provisioned.mcpGwApp.clientSecret = await this.getApplicationSecret(mcpGwAppResult.application.id);
      pushAppResultStep(steps, 'mcp-gw-app', 'MCP Gateway application', mcpGwAppResult);
      onStep(steps[steps.length - 1]);

      // Step 28: Configure MCP Gateway app (client_secret_post per T-9 — matches MCP_GW_TOKEN_ENDPOINT_AUTH_METHOD=post)
      if (!mcpGwAppResult.exists) {
        steps.push({ step: 'mcp-gw-config', icon: '⚙️', message: 'Configuring MCP Gateway application...' });
        onStep(steps[steps.length - 1]);
        await this.updateApplication(mcpGwAppResult.application.id, {
          tokenEndpointAuthMethod: 'client_secret_post'
        });
        steps.push({ step: 'mcp-gw-config', icon: '✅', message: 'MCP Gateway application configured' });
        onStep(steps[steps.length - 1]);
      }

      // Step 29: Grant scopes to MCP Gateway app (it is the RFC 8693 client for
      // exchange #2: it re-exchanges the inbound mcp-gw-audienced token for a
      // token audienced to the BACKEND MCP SERVER). PingOne checks the
      // exchanging client's grants against the TARGET resource, so the grant
      // MUST be on the MCP Server resource (mcpResourceResult — aud
      // mcp-server.*, what backendResourceUri()/mcpOlbResourceUri resolves to),
      // NOT the Super Banking API resource. mortgage:read is included
      // for the Phase 267 api_key disposition. (Previously this granted on
      // resourceResult/WORKER — both wrong: WORKER apps can't hold grants and
      // the API resource is not the exchange #2 target.)
      steps.push({ step: 'mcp-gw-grants', icon: '🔑', message: 'Granting scopes to MCP Gateway application...' });
      onStep(steps[steps.length - 1]);
      const mcpGwGrantResult = await this.grantScopesToApplication(
        mcpGwAppResult.application.id,
        mcpResourceResult.resource.id,
        ['read', 'write', 'mcp:invoke', 'mortgage:read']
      );
      pushGrantResultStep(steps, 'mcp-gw-grants', 'MCP Gateway scope grants', mcpGwGrantResult);
      onStep(steps[steps.length - 1]);

      // Step 30: Create Agent WORKER application
      // banking_agent_service requires AGENT_CLIENT_ID; without it port 3006 exits at startup.
      // The agent is the actor in delegated token-exchange (act.sub = AGENT_CLIENT_ID).
      steps.push({ step: 'agent-app', icon: '🤝', message: 'Creating Agent application...' });
      onStep(steps[steps.length - 1]);
      const agentAppResult = await this.createApplication(
        _provisioningAppName('Super Banking Agent'),
        'Worker actor identity for RFC 8693 delegated exchange. The act.sub claim on exchanged tokens.',
        'WORKER',
        ['client_credentials']
      );
      provisioned.agentApp = agentAppResult.application;
      provisioned.agentApp.clientSecret = await this.getApplicationSecret(agentAppResult.application.id);
      pushAppResultStep(steps, 'agent-app', 'Agent application', agentAppResult);
      onStep(steps[steps.length - 1]);

      // Step 31: Configure Agent app
      if (!agentAppResult.exists) {
        steps.push({ step: 'agent-config', icon: '⚙️', message: 'Configuring Agent application...' });
        onStep(steps[steps.length - 1]);
        await this.updateApplication(agentAppResult.application.id, {
          tokenEndpointAuthMethod: 'client_secret_post'
        });
        steps.push({ step: 'agent-config', icon: '✅', message: 'Agent application configured' });
        onStep(steps[steps.length - 1]);
      }

      // Step 32: Grant the agent the gateway scope so its token-exchange targets the gateway aud
      steps.push({ step: 'agent-grants', icon: '🔑', message: 'Granting scopes to Agent application...' });
      onStep(steps[steps.length - 1]);
      const agentGrantResult = await this.grantScopesToApplication(
        agentAppResult.application.id,
        mcpGwResourceResult.resource.id,
        ['mcp:invoke']
      );
      pushGrantResultStep(steps, 'agent-grants', 'Agent scope grants', agentGrantResult);
      onStep(steps[steps.length - 1]);

      // ─────────────────────────────────────────────────────────────────────
      // Phase 268 — Two-Exchange Delegation (RFC 8693 §2.1) infrastructure
      // ─────────────────────────────────────────────────────────────────────
      // The Two-Exchange flow needs four distinct audiences and one new app
      // beyond what the single-exchange flow uses:
      //   Step 1 — AI Agent CC token        → audience = AGENT_GATEWAY_AUD       (NEW resource server)
      //   Step 2 — Exchange #1 final token  → audience = INTERMEDIATE_AUD        (NEW resource server)
      //   Step 3 — MCP Exchanger CC token   → audience = MCP_GATEWAY_AUD         (existing MCP Gateway)
      //   Step 4 — Exchange #2 final token  → audience = TWO_EXCHANGE_FINAL_AUD  (NEW resource server)
      // Plus a new "Super Banking AI Agent" worker app to act as the LLM
      // identity in Exchange #1 (act.sub on the exchanged token).
      // The MCP Token Exchanger (created above) is reused as the actor in
      // Exchange #2; we additionally export its credentials under
      // AGENT_OAUTH_CLIENT_ID/SECRET (the names the validator expects).

      // Step 33: Create Agent Gateway resource server (Step 1 audience).
      // Every resource server needs at least one scope (PingOne requirement);
      // we add `openid` immediately after creation to satisfy that and to give
      // Token Chain UI a labelled scope to display.
      steps.push({ step: 'agent-gw-resource', icon: '🛡️', message: 'Creating Agent Gateway resource server (Two-Exchange Step 1)...' });
      onStep(steps[steps.length - 1]);
      const agentGwAud = config.agentGatewayAudience || 'agentgateway.ping.demo';
      const agentGwResourceResult = await this.createResourceServer(
        _provisioningResourceName('Super Banking Agent Gateway'),
        'Two-Exchange Step 1 audience — AI Agent client-credentials token target',
        agentGwAud
      );
      provisioned.agentGwResourceServer = agentGwResourceResult.resource;
      steps.push({ step: 'agent-gw-resource', icon: '✅', message: `Agent Gateway resource ${agentGwResourceResult.exists ? 'reused' : 'created'} (aud: ${agentGwAud})` });
      onStep(steps[steps.length - 1]);
      // Custom scope name (NOT 'openid' — that's a PingOne system-defined scope
      // and POSTing it to a CUSTOM resource fails with INVALID_DATA, leaving the
      // resource scope-less). Any custom name satisfies the "at least one scope
      // per resource" requirement; we pick a name that reads in the Token Chain UI.
      // Derived from scope-topology.json "Super Banking Agent Gateway".
      const agentGwScopeResults = await this.createScopes(
        agentGwResourceResult.resource.id,
        topologyResourceScopeObjects('Super Banking Agent Gateway'),
      );
      pushScopeResultStep(steps, 'agent-gw-scopes', 'Agent Gateway scopes', agentGwScopeResults);
      onStep(steps[steps.length - 1]);

      // Step 35.5: Wire `may_act` on the Agent Gateway resource.
      //
      // The intermediate token (Exchange #1 result, aud=agentgateway.ping.demo) must
      // carry may_act.sub = MCP Exchanger client ID so PingOne:
      //   a) authorises the Exchanger to present this token in Exchange #2
      //   b) emits act.sub = Exchanger in the final MCP token (aud=mcpgateway.ping.demo)
      //
      // Without this, PingOne completes Exchange #2 but does NOT emit act — leaving
      // the final token without a delegation chain. The Authorization Server then sees
      // ActClientId="" and cannot enforce the actor. RFC 8693 §4.1 requires act.
      steps.push({ step: 'agent-gw-may-act', icon: '🔧', message: 'Wiring may_act on Agent Gateway resource → MCP Exchanger (Exchange #2 delegation)...' });
      onStep(steps[steps.length - 1]);
      try {
        const mcpExchangerClientId = provisioned.mcpExchangerApp?.clientId;
        if (!mcpExchangerClientId) {
          steps.push({ step: 'agent-gw-may-act', icon: '⚠️', message: 'MCP Exchanger client id missing — skipping Agent Gateway may_act' });
        } else {
          // Static may_act for Exchange #2: a LITERAL JSON object value, NOT a
          // `#{'sub':'...'}` SpEL map literal. This env emits `#{...}` VERBATIM as a
          // string (the documented may_act bug — see step 23.5), which would leave the
          // intermediate token's may_act as the literal text and PingOne would NOT emit
          // the nested act. The Demo MCP Server resource already uses this literal-JSON
          // form for the same actor; mirror it here. (Verified live 2026-06-09: gateway
          // had `#{'sub':...}` while MCP Server had `{"sub":"..."}`.)
          const agentGwMayActValue = JSON.stringify({ sub: mcpExchangerClientId });
          await this._setResourceAttribute(
            agentGwResourceResult.resource.id,
            'may_act',
            agentGwMayActValue
          );
          steps.push({ step: 'agent-gw-may-act', icon: '✅', message: `Agent Gateway may_act wired (literal { sub: ${mcpExchangerClientId} }) — act claim will appear in final MCP token` });
        }
      } catch (agentGwMayActErr) {
        steps.push({ step: 'agent-gw-may-act', icon: '⚠️', message: `Agent Gateway may_act step: ${agentGwMayActErr.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 36: Create AI Agent application (the LLM identity in Two-Exchange).
      //
      // App type is WEB_APP (NOT WORKER) for the same reason as the MCP Exchanger
      // — see docs/token-flow-audit.md. WORKER tokens silently bind to the Mgmt
      // API audience and break the Two-Exchange Step 1 actor-token aud. WEB_APP
      // with a scope grant on a custom resource produces a CC token bound to
      // that resource's audience.
      steps.push({ step: 'ai-agent-app', icon: '🤖', message: 'Creating Super Banking AI Agent application (Two-Exchange actor)...' });
      onStep(steps[steps.length - 1]);
      const aiAgentAppResult = await this.createApplication(
        _provisioningAppName('Super Banking AI Agent'),
        'AI agent identity for Two-Exchange Step 1. Actor token in the user→AI-agent delegation chain. NOT a WORKER — see docs/token-flow-audit.md.',
        'WEB_APP',
        ['authorization_code', 'client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange']
      );
      provisioned.aiAgentApp = aiAgentAppResult.application;
      provisioned.aiAgentApp.clientSecret = await this.getApplicationSecret(aiAgentAppResult.application.id);
      pushAppResultStep(steps, 'ai-agent-app', 'AI Agent application', aiAgentAppResult);
      onStep(steps[steps.length - 1]);

      // Step 37: Configure AI Agent redirect URI + auth method.
      // WEB_APP needs redirectUris; the authorization_code flow is never used
      // for this app — it only mints CC tokens for token-exchange.
      if (!aiAgentAppResult.exists) {
        steps.push({ step: 'ai-agent-config', icon: '⚙️', message: 'Configuring AI Agent application...' });
        onStep(steps[steps.length - 1]);
        await this.updateApplication(aiAgentAppResult.application.id, {
          redirectUris: [`${config.publicAppUrl}/api/auth/oauth/ai-agent-placeholder-callback`],
          tokenEndpointAuthMethod: 'client_secret_post',
        });
        steps.push({ step: 'ai-agent-config', icon: '✅', message: 'AI Agent application configured' });
        onStep(steps[steps.length - 1]);
      }

      // Step 37a: Grant scopes the AI Agent needs for the two-exchange delegation chain.
      //
      // Two-exchange chain:
      //   Exchange #1: AI Agent exchanges user token (aud=enduser.ping.demo) +
      //                AI Agent actor CC (aud=agentgateway.ping.demo) →
      //                intermediate token (aud=agentgateway.ping.demo).
      //   Exchange #2: MCP Exchanger exchanges intermediate token (aud=agentgateway) +
      //                MCP Exchanger actor CC (aud=mcpgateway.ping.demo) →
      //                final MCP token (aud=mcpgateway.ping.demo).
      //
      // AI Agent needs:
      //   - agent:invoke on Agent Gateway (actor CC token for Exchange #1)
      //   - read/write/transfer/ai:agent:read/mortgage:read on Demo API / enduser resource
      //     so PingOne allows Exchange #1 to accept a user subject token with
      //     aud=enduser.ping.demo (PingOne requires the exchanging client to have
      //     a grant on the subject token's audience resource).
      steps.push({ step: 'ai-agent-grants', icon: '✅', message: 'Granting scopes to AI Agent application (Agent Gateway actor + Demo API subject)...' });
      onStep(steps[steps.length - 1]);
      try {
        // SYNC: agent:invoke scope matches configStore default `agent_gateway_cc_scope`.
        // Enduser grant lets Exchange #1 accept a subject token with aud=enduser.ping.demo.
        const [aiAgentGwGrant, aiAgentEndUserGrant] = await Promise.all([
          this.grantScopesToApplication(
            aiAgentAppResult.application.id,
            agentGwResourceResult.resource.id,
            ['agent:invoke'],
          ),
          this.grantScopesToApplication(
            aiAgentAppResult.application.id,
            resourceResult.resource.id,
            ['read', 'write', 'transfer', 'ai:agent:read', 'mortgage:read'],
          ),
        ]);
        pushGrantResultStep(steps, 'ai-agent-grants', 'AI Agent scope grants', [aiAgentGwGrant, aiAgentEndUserGrant]);
      } catch (e) {
        steps.push({ step: 'ai-agent-grants', icon: '⚠️', message: `AI Agent grant skipped: ${e.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 37a-A2A: Agent-to-Agent (A2A) — the A2A Intermediate resource + one
      // specialist app per vertical (Agent 2). The generalist (AI Agent = Agent 1)
      // performs Exchange #1 (user → intermediate); the specialist performs
      // Exchange #2 (intermediate + specialist actor → gateway), nesting the act
      // chain. Each specialist is granted ONLY its derived scope (least privilege);
      // the scope is read from the SoT (scope-topology.json) via its tools — never
      // re-declared here. Fully wrapped so a failure never breaks bootstrap.
      try {
        const { A2A_SPECIALISTS } = require('../config/a2aSpecialists');
        const _scopeTopology = require('./scopeTopology');

        const a2aAud = config.a2aIntermediateAudience || 'a2a-intermediate.ping.demo';
        steps.push({ step: 'a2a-resource', icon: '🛡️', message: `Creating A2A Intermediate resource (aud: ${a2aAud})...` });
        onStep(steps[steps.length - 1]);
        const a2aResourceResult = await this.createResourceServer(
          _provisioningResourceName('Super Banking A2A Intermediate'),
          'A2A intermediate audience — Exchange #1 result of the agent-to-agent chained RFC 8693 delegation.',
          a2aAud,
        );
        provisioned.a2aResourceServer = a2aResourceResult.resource;
        const a2aScopeResults = await this.createScopes(
          a2aResourceResult.resource.id,
          topologyResourceScopeObjects('Super Banking A2A Intermediate'),
        );
        pushScopeResultStep(steps, 'a2a-resource', 'A2A Intermediate scopes', a2aScopeResults);
        onStep(steps[steps.length - 1]);

        // Agent 1 (AI Agent) needs agent:invoke on the A2A intermediate to mint Exchange #1.
        await this.grantScopesToApplication(aiAgentAppResult.application.id, a2aResourceResult.resource.id, ['agent:invoke']);

        // One specialist app per vertical (Agent 2), each granted ONLY its derived scope.
        provisioned.a2aSpecialistApps = {};
        for (const spec of Object.values(A2A_SPECIALISTS)) {
          const specScopes = [...new Set((spec.tools || []).flatMap((t) => _scopeTopology.toolScopes(t)))];
          steps.push({ step: `a2a-${spec.appKey}-app`, icon: '🤖', message: `Creating ${spec.specialistName} (A2A specialist)...` });
          onStep(steps[steps.length - 1]);
          const specResult = await this.createApplication(
            _provisioningAppName(spec.appName),
            `${spec.specialistName} — A2A specialist agent (Agent 2). Actor in the chained delegation; granted only [${specScopes.join(' ')}].`,
            'WEB_APP',
            ['client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange'],
          );
          const app = specResult.application;
          app.clientSecret = await this.getApplicationSecret(app.id);
          provisioned.a2aSpecialistApps[spec.appKey] = app;
          if (!specResult.exists) {
            await this.updateApplication(app.id, { tokenEndpointAuthMethod: 'client_secret_post' });
          }
          // Narrow scope on Demo API (mints the Exchange #2 token) + agent:invoke on the
          // A2A intermediate (accept the Exchange #1 subject token, aud=a2a-intermediate).
          await Promise.all([
            this.grantScopesToApplication(app.id, resourceResult.resource.id, specScopes),
            this.grantScopesToApplication(app.id, a2aResourceResult.resource.id, ['agent:invoke']),
          ]);
          pushAppResultStep(steps, `a2a-${spec.appKey}-app`, spec.specialistName, specResult);
          onStep(steps[steps.length - 1]);
        }
      } catch (a2aErr) {
        steps.push({ step: 'a2a-specialists', icon: '⚠️', message: `A2A specialist provisioning skipped: ${a2aErr.message}` });
        onStep(steps[steps.length - 1]);
      }

      // Step 37b: Grant scopes the MCP Exchanger needs for Exchange #2.
      //
      // MCP Exchanger needs:
      //   - agent:invoke on Agent Gateway — PingOne requires the exchanging client to
      //     have a grant on the subject token's audience resource so it can accept an
      //     intermediate subject token with aud=agentgateway.ping.demo.
      //   - Tool scopes on MCP Gateway (FINAL audience). Grant first — PingOne enforces
      //     one scope-name per app across all grants, so these names must land on the
      //     Gateway resource before the MCP Server grant runs.
      //   - Admin-only scopes on MCP Server (unique to that resource).
      // SYNC: MCP-Gateway scopes match configStore defaults `mcp_gateway_cc_scope` /
      // mcp_token_exchange_scopes.
      steps.push({ step: 'mcp-exchanger-grants', icon: '✅', message: 'Granting scopes to MCP Exchanger application (Agent Gateway + MCP Gateway + MCP Server)...' });
      onStep(steps[steps.length - 1]);
      try {
        // Agent GW and MCP GW grants are independent; MCP Server grant must come after
        // MCP GW so the cross-resource one-name filter assigns shared names to GW first.
        const [mcpExAgentGwGrant, mcpExGwGrant] = await Promise.all([
          this.grantScopesToApplication(
            mcpExchangerResult.application.id,
            agentGwResourceResult.resource.id,
            ['agent:invoke'],
          ),
          this.grantScopesToApplication(
            mcpExchangerResult.application.id,
            mcpGwResourceResult.resource.id,
            scopeTopology.resourceScopes('Super Banking MCP Gateway'),
          ),
        ]);
        const mcpExServerGrant = await this.grantScopesToApplication(
          mcpExchangerResult.application.id,
          mcpResourceResult.resource.id,
          scopeTopology.resourceScopes('Super Banking MCP Server'),
        );
        pushGrantResultStep(steps, 'mcp-exchanger-grants', 'MCP Exchanger scope grants', [mcpExAgentGwGrant, mcpExGwGrant, mcpExServerGrant]);
      } catch (e) {
        steps.push({ step: 'mcp-exchanger-grants', icon: '⚠️', message: `MCP Exchanger grant skipped: ${e.message}` });
      }
      onStep(steps[steps.length - 1]);

      // Historical note: the previous WORKER-based provisioning had no explicit
      // scope grant because grantScopesToApplication skips WORKER apps entirely
      // (line ~758 — "PingOne forbids resource access grants on WORKER apps").
      // With the app types switched to WEB_APP above, grant calls now succeed
      // and are required for the CC mint to honor custom audiences.
      // If the apps need explicit policy wiring (e.g. "this app may exchange
      // for this resource"), that's done in Phase B via the resource server's
      // token-exchange policy — not at provisioning time here.

      // Step 32b: Create PingOne MCP Server app (developer tooling — not a demo runtime component)
      // This app is the OAuth client that AI assistants (Claude Code, Cursor, etc.) use to connect
      // to the HOSTED PingOne MCP server (https://api.pingone.{region}/v1/environments/{envId}/mcp)
      // so developers can administer the PingOne tenant via natural language.
      // Auth method must be NONE (PKCE, no client secret); createApplication sets that
      // and (for a NATIVE_APP with authorization_code) responseTypes=['CODE'] +
      // pkceEnforcement='S256_REQUIRED'. It does NOT set redirectUris, so we register
      // the loopback callback (http://localhost:7464/callback — Claude Code's callbackPort)
      // via updateApplication (a GET+merge+PUT, which CAN set redirectUris on a NATIVE_APP).
      steps.push({ step: 'pingone-mcp-server-app', icon: '🔧', message: 'Creating PingOne MCP Server app (dev tooling)...' });
      onStep(steps[steps.length - 1]);
      const pingOneMcpServerAppResult = await this.createApplication(
        'PingOne MCP Server',
        'OAuth client for AI assistants to reach the hosted PingOne MCP server (PKCE, no secret, no app roles)',
        'NATIVE_APP',
        ['authorization_code', 'refresh_token'],
        'none'
      );
      pushAppResultStep(steps, 'pingone-mcp-server-app', 'PingOne MCP Server app (dev tooling)', pingOneMcpServerAppResult);
      onStep(steps[steps.length - 1]);
      provisioned.pingOneMcpServerApp = pingOneMcpServerAppResult.application;
      // Register the loopback redirect URI so the OAuth browser flow works out of the box.
      const pingOneMcpAppId = pingOneMcpServerAppResult.application?.id;
      if (pingOneMcpAppId) {
        try {
          const updatedMcpApp = await this.updateApplication(pingOneMcpAppId, {
            // Register both loopback hosts — different MCP clients use localhost vs
            // 127.0.0.1, and PingOne requires an exact redirect_uri match.
            redirectUris: ['http://localhost:7464/callback', 'http://127.0.0.1:7464/callback'],
          });
          if (updatedMcpApp?.clientId) provisioned.pingOneMcpServerApp = updatedMcpApp;
        } catch (err) {
          // Non-fatal: the app is created; the redirect can still be set in the console.
          steps.push({ step: 'pingone-mcp-server-app-redirect', icon: '⚠️',
            message: `Could not set PingOne MCP app redirect URI automatically: ${err.message}` });
          onStep(steps[steps.length - 1]);
        }
      }

      // Step 32c: Create the "Claude Code - Banking Gateway" OAuth client (dev tooling).
      // This is the OAuth client Claude Code's `banking-gateway` MCP server uses to do the
      // RFC 9728 / MCP OAuth browser flow against the LOCAL gateway (:3005). Public NATIVE_APP
      // (PKCE, no secret). Granted the MCP Gateway resource scopes so its user tokens carry
      // aud=mcpgateway.ping.demo (what the gateway validates). Redirect = Claude Code's
      // callbackPort 7465 (distinct from the PingOne MCP app's 7464).
      steps.push({ step: 'banking-gateway-mcp-app', icon: '🔧', message: 'Creating Banking Gateway MCP OAuth app (dev tooling)...' });
      onStep(steps[steps.length - 1]);
      const bankingGatewayMcpAppResult = await this.createApplication(
        'Claude Code - Banking Gateway',
        'OAuth client for Claude Code to reach the local MCP Gateway via MCP OAuth (PKCE, no secret)',
        'NATIVE_APP',
        ['authorization_code', 'refresh_token'],
        'none'
      );
      pushAppResultStep(steps, 'banking-gateway-mcp-app', 'Banking Gateway MCP OAuth app (dev tooling)', bankingGatewayMcpAppResult);
      onStep(steps[steps.length - 1]);
      provisioned.bankingGatewayMcpApp = bankingGatewayMcpAppResult.application;
      const bankingGatewayMcpAppId = bankingGatewayMcpAppResult.application?.id;
      if (bankingGatewayMcpAppId) {
        try {
          const updatedBgwApp = await this.updateApplication(bankingGatewayMcpAppId, {
            redirectUris: ['http://localhost:7465/callback', 'http://127.0.0.1:7465/callback'],
          });
          if (updatedBgwApp?.clientId) provisioned.bankingGatewayMcpApp = updatedBgwApp;
        } catch (err) {
          steps.push({ step: 'banking-gateway-mcp-app-redirect', icon: '⚠️',
            message: `Could not set Banking Gateway MCP app redirect URI automatically: ${err.message}` });
          onStep(steps[steps.length - 1]);
        }
        // Grant the MCP Gateway resource scopes so Claude Code's user token has aud=mcpgateway.ping.demo.
        try {
          const bgwGrantResult = await this.grantScopesToApplication(
            bankingGatewayMcpAppId,
            mcpResourceResult.resource.id,
            ['read', 'write', 'mcp:invoke', 'mortgage:read']
          );
          pushGrantResultStep(steps, 'banking-gateway-mcp-grants', 'Banking Gateway MCP scope grants', bgwGrantResult);
          onStep(steps[steps.length - 1]);
        } catch (err) {
          steps.push({ step: 'banking-gateway-mcp-grants', icon: '⚠️',
            message: `Could not grant Banking Gateway MCP scopes automatically: ${err.message}` });
          onStep(steps[steps.length - 1]);
        }
      }

      // Step 33: Write configuration
      steps.push({ step: 'config', icon: '📝', message: 'Writing .env file...' });
      onStep(steps[steps.length - 1]);

      // Validate environment consistency before writing
      this.validateEnvironmentConsistency(config, provisioned);

      {
        const envPath = await this.writeEnvFile(config, provisioned);
        steps.push({ step: 'config', icon: '✅', message: `.env file written to ${envPath}` });
      }
      onStep(steps[steps.length - 1]);

      // Step 33b: Durably wire the MCP server's introspection identity into
      // demo_mcp_server/.env.development (the file run-demo.sh copies over
      // its .env). Without this a fresh no-vault setup:fresh reintroduces the
      // gateway->MCP 401 (REGRESSION_PLAN §4 2026-05-18).
      {
        const mcpDevPath = await this.writeMcpServerIntrospectionIdentity(provisioned);
        steps.push({
          step: 'config',
          icon: mcpDevPath ? '✅' : '⚠️',
          message: mcpDevPath
            ? `MCP server introspection identity written to ${mcpDevPath}`
            : 'MCP server .env.development not patched (absent or gateway app unprovisioned) — vault/template covers it',
        });
      }
      onStep(steps[steps.length - 1]);

      // Step 16: Complete
      steps.push({ 
        step: 'complete', 
        icon: '🎉', 
        message: 'Setup complete! All resources provisioned successfully.',
        result: provisioned 
      });
      onStep(steps[steps.length - 1]);

      return {
        success: true,
        provisioned,
        steps: steps.filter(s => s.step !== 'complete')
      };

    } catch (error) {
      steps.push({ 
        step: 'error', 
        icon: '❌', 
        message: `Setup failed: ${error.message}` 
      });
      onStep(steps[steps.length - 1]);
      
      throw error;
    }
  }

  /**
   * Enable token customization for an application.
   *
   * NOTE: PingOne's API doesn't have a per-application "tokenCustomization"
   * endpoint — the previous PUT /applications/{id}/tokenCustomization call
   * returned 403 because the URL pattern doesn't exist (PingOne's API
   * gateway rejected the path before token validation, returning a
   * misleading "Invalid Authorization header" message).
   *
   * Token customization in PingOne is configured at the RESOURCE SERVER
   * level via attributes (POST /resources/{id}/attributes). Attributes
   * defined on a resource appear as claims in tokens issued for that
   * resource server. This function is now a no-op for backward
   * compatibility — the actual claims (`may_act`, `bankingPrincipalUserId`)
   * are added per-resource in the wizard's resource-creation step.
   *
   * Returns immediately without making an API call.
   */
  async enableTokenCustomization(_appId) {
    return { skipped: true, reason: 'no-op — token customization is per-resource, not per-app' };
  }

  /**
   * Add a custom token claim.
   *
   * The original implementation called POST /applications/{id}/tokenClaims —
   * an endpoint that doesn't exist in PingOne's Management API.
   *
   * The correct PingOne pattern is to add a custom attribute to the resource
   * server (POST /resources/{id}/attributes), which then appears as a claim
   * in tokens whose audience is that resource. This wrapper is now a no-op
   * because the resource-server attribute creation belongs at the resource-
   * provisioning step, not the application-provisioning step. The two
   * special claims previously requested here:
   *
   *   - `may_act` on admin app  → emitted automatically by PingOne when the
   *     resource server's token policy supports RFC 8693 token-exchange.
   *     Configure via PingOne Admin Console → Authorization → Resources →
   *     Token Policies if needed.
   *
   *   - `bankingPrincipalUserId` SPEL claim on user app → can be added as a
   *     CUSTOM resource attribute on `Super Banking API` if you need it as
   *     a claim. The demo flows don't require it on first install.
   *
   * Returns immediately without making an API call.
   */
  async addTokenClaim(_appId, _claimName, _claimType, _value) {
    return { skipped: true, reason: 'no-op — custom claims are per-resource attributes' };
  }

  /**
   * Recreate a specific resource
   */
  async recreateResource(config, resourceKey) {
    const [type, id] = resourceKey.split(':');

    try {
      switch (type) {
        case 'resource':
          await this.makeRequest('DELETE', `/resources/${id}`);
          return { success: true, message: 'Resource server deleted' };

        case 'application':
          await this.makeRequest('DELETE', `/applications/${id}`);
          return { success: true, message: 'Application deleted' };

        case 'user':
          await this.makeRequest('DELETE', `/users/${id}`);
          return { success: true, message: 'User deleted' };

        default:
          throw new Error(`Unknown resource type: ${type}`);
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Nuclear option: delete EVERYTHING in the environment that we can.
   *
   * Deletes:
   *   - All applications EXCEPT the worker app being used to authenticate
   *     (deleting that mid-run kills the access token).
   *   - All resource servers EXCEPT system-defaults `PingOne API` and `openid`
   *     (PingOne refuses to delete them anyway).
   *   - All groups.
   *   - All custom user-schema attributes (CORE / STANDARD attrs are
   *     PingOne-managed and rejected).
   *   - All non-CORE users in the default population.
   *
   * Does NOT delete:
   *   - The environment itself.
   *   - The worker app (`config.workerClientId` is the actor — would invalidate
   *     the very token we're holding).
   *   - System-default resource servers.
   *   - Built-in user-schema attributes.
   *
   * Streams progress via onStep callback (same shape as provisionEnvironment).
   * Per-item failures don't abort; reported in the summary. Returns:
   *   { deleted: { apps, resources, groups, attrs, users },
   *     skipped: { ... }, failed: [...] }
   */
  async wipeEnvironment(config, onStep = () => {}) {
    await this.initialize(config.envId, config.workerClientId, config.workerClientSecret, config.region);

    const summary = {
      deleted: { apps: 0, resources: 0, groups: 0, attrs: 0, users: 0 },
      skipped: { apps: 0, resources: 0, groups: 0, attrs: 0, users: 0 },
      failed:  [],
    };
    const step = (icon, message, extra = {}) => onStep({ step: 'wipe', icon, message, ...extra });

    // Banking-demo ownership filter. Everything provisioned by this demo
    // matches one of these patterns; everything else (PingOne system apps,
    // user-managed apps, shared infrastructure) is left alone.
    //
    // Apps + resources: name starts with "Demo" (the provisioning prefix).
    // Groups:           name equals "BankDelegates".
    // Custom attrs:     name equals "isDelegate" (the only one we provision).
    // Users:            username in {demoUser, demoAdmin, demoDelegate}.
    //
    // If you fork this demo and rename, update the constants here too.
    const APP_PREFIXES = ['Super Banking', 'Demo'];
    const RESOURCE_PREFIXES = ['Super Banking', 'Demo'];
    const isOwnedApp = (name) => APP_PREFIXES.some(p => (name || '').startsWith(p));
    const isOwnedResource = (name) => RESOURCE_PREFIXES.some(p => (name || '').startsWith(p));
    const DEMO_GROUPS = new Set(['BankDelegates', 'PrivilegedBanking']);
    const DEMO_ATTRS = new Set(['isDelegate', 'mayAct', 'delegatedTo', 'bankingPrincipalUserId', 'agentRestrictions']);
    const DEMO_USERS = new Set(['demoUser', 'demoAdmin', 'demoDelegate']);

    step('💣', `Wiping banking-demo resources in PingOne env ${config.envId} (region: ${config.region})`);
    step('🛡️', `Only items matching banking-demo naming will be deleted; everything else is preserved.`);

    // --- Apps -----------------------------------------------------------
    step('🔍', 'Listing applications…');
    let apps = [];
    try {
      apps = (await this.makeRequest('GET', '/applications')).data._embedded?.applications || [];
    } catch (err) {
      step('❌', `Could not list applications: ${err.message}`);
    }
    const ownedApps = apps.filter(a => isOwnedApp(a.name));
    step('🗑️', `Found ${apps.length} application(s); ${ownedApps.length} match demo prefixes — preserving worker (${config.workerClientId})`);
    for (const app of apps) {
      // Always preserve the worker we're auth'd as — even if it has the prefix.
      if (app.id === config.workerClientId || app.clientId === config.workerClientId) {
        summary.skipped.apps++;
        step('⏭️', `Kept worker app: ${app.name}`);
        continue;
      }
      if (!isOwnedApp(app.name)) {
        summary.skipped.apps++;
        // Don't spam a line per non-demo app; total skipped count surfaces in the summary.
        continue;
      }
      try {
        await this.makeRequest('DELETE', `/applications/${app.id}`);
        summary.deleted.apps++;
        step('✅', `Deleted app: ${app.name}`);
      } catch (err) {
        summary.failed.push({ kind: 'app', id: app.id, name: app.name, error: err.message });
        step('❌', `Failed to delete app '${app.name}': ${err.message}`);
      }
    }

    // --- Resource servers ------------------------------------------------
    step('🔍', 'Listing resource servers…');
    let resources = [];
    try {
      resources = (await this.makeRequest('GET', '/resources')).data._embedded?.resources || [];
    } catch (err) {
      step('❌', `Could not list resources: ${err.message}`);
    }
    for (const r of resources) {
      if (!isOwnedResource(r.name)) {
        summary.skipped.resources++;
        continue;
      }
      try {
        await this.makeRequest('DELETE', `/resources/${r.id}`);
        summary.deleted.resources++;
        step('✅', `Deleted resource: ${r.name}`);
      } catch (err) {
        summary.failed.push({ kind: 'resource', id: r.id, name: r.name, error: err.message });
        step('❌', `Failed to delete resource '${r.name}': ${err.message}`);
      }
    }

    // --- Groups ----------------------------------------------------------
    step('🔍', 'Listing groups…');
    let groups = [];
    try {
      groups = (await this.makeRequest('GET', '/groups')).data._embedded?.groups || [];
    } catch (err) {
      step('❌', `Could not list groups: ${err.message}`);
    }
    for (const g of groups) {
      if (!DEMO_GROUPS.has(g.name)) {
        summary.skipped.groups++;
        continue;
      }
      try {
        await this.makeRequest('DELETE', `/groups/${g.id}`);
        summary.deleted.groups++;
        step('✅', `Deleted group: ${g.name}`);
      } catch (err) {
        summary.failed.push({ kind: 'group', id: g.id, name: g.name, error: err.message });
        step('❌', `Failed to delete group '${g.name}': ${err.message}`);
      }
    }

    // --- User schema attributes -----------------------------------------
    // CUSTOM only — CORE/STANDARD are managed by PingOne and refuse delete.
    // We further filter to attributes the demo provisions (isDelegate).
    step('🔍', 'Listing custom user-schema attributes…');
    try {
      if (!this._userSchemaId) {
        const schemas = (await this.makeRequest('GET', '/schemas?filter=name eq "User"')).data;
        this._userSchemaId = schemas._embedded?.schemas?.[0]?.id;
      }
      if (this._userSchemaId) {
        const attrs = (await this.makeRequest('GET', `/schemas/${this._userSchemaId}/attributes`)).data._embedded?.attributes || [];
        for (const a of attrs) {
          if (a.type !== 'CUSTOM' || !DEMO_ATTRS.has(a.name)) {
            summary.skipped.attrs++;
            continue;
          }
          try {
            await this.makeRequest('DELETE', `/schemas/${this._userSchemaId}/attributes/${a.id}`);
            summary.deleted.attrs++;
            step('✅', `Deleted user attribute: ${a.name}`);
          } catch (err) {
            summary.failed.push({ kind: 'attr', id: a.id, name: a.name, error: err.message });
            step('❌', `Failed to delete attribute '${a.name}': ${err.message}`);
          }
        }
      }
    } catch (err) {
      step('❌', `Could not enumerate user schema: ${err.message}`);
    }

    // --- Users -----------------------------------------------------------
    // Only delete demo accounts. PingOne paginates; loop until we've checked
    // a full page that has no demo users in it (we don't blindly drain — we
    // just need to find the 3 demo users by username).
    step('🔍', 'Deleting demo users (demoUser, demoAdmin, demoDelegate)…');
    for (const username of DEMO_USERS) {
      try {
        const q = encodeURIComponent(`username eq "${username}"`);
        const page = await this.makeRequest('GET', `/users?filter=${q}&limit=10`);
        const users = page.data._embedded?.users || [];
        if (users.length === 0) {
          // Nothing to delete; count as skipped so summary doesn't lie.
          summary.skipped.users++;
          continue;
        }
        for (const u of users) {
          try {
            await this.makeRequest('DELETE', `/users/${u.id}`);
            summary.deleted.users++;
            step('✅', `Deleted user: ${u.username}`);
          } catch (err) {
            summary.failed.push({ kind: 'user', id: u.id, name: u.username, error: err.message });
            step('❌', `Failed to delete user '${u.username}': ${err.message}`);
          }
        }
      } catch (err) {
        step('❌', `Could not search for user '${username}': ${err.message}`);
      }
    }

    const totalSkipped = summary.skipped.apps + summary.skipped.resources + summary.skipped.groups + summary.skipped.attrs + summary.skipped.users;
    step('🎉', `Wipe complete. Deleted: ${summary.deleted.apps} apps, ${summary.deleted.resources} resources, ${summary.deleted.groups} groups, ${summary.deleted.attrs} attrs, ${summary.deleted.users} users. Preserved (non-demo): ${totalSkipped}. Failures: ${summary.failed.length}.`);
    return summary;
  }

  /**
   * Generate secure password
   */
  generatePassword() {
    // PingOne's default password policy requires:
    //   - min length 8 (we use 16 to satisfy stricter policies)
    //   - at least 1 uppercase, 1 lowercase, 1 digit, 1 special
    //   - no more than 2 repeated characters
    // The previous random-only generator could fail policy checks ~5% of the
    // time (e.g. all letters, no digits). Build a guaranteed-compliant password
    // by drawing 2-4 chars from each class, then shuffling.
    const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // omit I/O for legibility
    const lower   = 'abcdefghjkmnpqrstuvwxyz';    // omit i/l/o
    const digits  = '23456789';                    // omit 0/1
    const symbols = '!@#$%^&*-_+=';

    const pick = (set, n) => {
      let s = '';
      for (let i = 0; i < n; i++) s += set[Math.floor(Math.random() * set.length)];
      return s;
    };

    // 4 of each class → 16 chars total, exceeds nearly every policy minimum.
    const chars = (pick(upper, 4) + pick(lower, 4) + pick(digits, 4) + pick(symbols, 4)).split('');
    // Fisher-Yates shuffle so the class boundaries aren't visible.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }
}

// Export singleton instance and class
const provisionService = new PingOneProvisionService();

module.exports = {
  PingOneProvisionService,
  provisionService,
  DEMO_PASSWORD,
  provisionEnvironment: (config, onStep) => provisionService.provisionEnvironment(config, onStep),
  recreateResource: (config, resourceKey) => provisionService.recreateResource(config, resourceKey),
  // Caller MUST construct a fresh service instance for wipe — the module
  // singleton may have leftover state from a prior provision call. Each
  // wipeEnvironment call also re-initializes (calls getWorkerToken).
  wipeEnvironment: (config, onStep) => new PingOneProvisionService().wipeEnvironment(config, onStep),
  checkResourceExists: (type, name) => provisionService.findResourceByName(type, name)
};
