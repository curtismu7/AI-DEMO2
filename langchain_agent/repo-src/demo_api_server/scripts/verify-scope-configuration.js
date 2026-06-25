#!/usr/bin/env node

/**
 * verify-scope-configuration.js
 * 
 * Verifies that PingOne resources have the correct scopes attached.
 * Uses PingOne Management API to audit scope configuration.
 * 
 * Usage:
 *   node scripts/verify-scope-configuration.js [--fix]
 * 
 * Options:
 *   --fix    Attempt to auto-fix missing scopes (requires PINGONE_MGMT_CLIENT_ID/SECRET)
 * 
 * Environment:
 *   PINGONE_ENVIRONMENT_ID        — PingOne environment UUID
 *   PINGONE_MGMT_CLIENT_ID        — Management API worker app client ID
 *   PINGONE_MGMT_CLIENT_SECRET    — Management API worker app secret
 *   PINGONE_REGION                — PingOne region (default: com)
 *   PINGONE_RESOURCE_MCP_SERVER_URI     — MCP server resource URI (optional)
 *   PINGONE_RESOURCE_AGENT_GATEWAY_URI  — Agent gateway resource URI (optional)
 *   etc.
 */

'use strict';

// Load environment variables from .env file
require('dotenv').config();

const https = require('https');
const scopeTopology = require('../services/scopeTopology');

// Color codes for output
const COLORS = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
};

function log(...args) {
  console.log(...args);
}

function logError(msg) {
  console.error(`${COLORS.RED}❌ ${msg}${COLORS.RESET}`);
}

function logWarn(msg) {
  console.warn(`${COLORS.YELLOW}⚠️  ${msg}${COLORS.RESET}`);
}

function logSuccess(msg) {
  console.log(`${COLORS.GREEN}✅ ${msg}${COLORS.RESET}`);
}

function logInfo(msg) {
  console.log(`${COLORS.CYAN}ℹ️  ${msg}${COLORS.RESET}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Expected Scope Configuration
// ─────────────────────────────────────────────────────────────────────────────

// DERIVED from scope-topology.json (the SSOT). Keyed by resource AUDIENCE (uri).
// requiredScopes = the resource's own scopes PLUS any mirroredScopes — scopes
// minted onto this audience for downstream gateway/server enforcement
// (e.g. invest:read on mcpgateway.ping.demo, per ARCHITECTURE-TRUTHS T-10).
// Do NOT hand-edit scope lists here — edit scope-topology.json. Resources are
// matched against live PingOne by EXACT audience, so legacy/duplicate resources
// (mcpgateway-old.ping.demo, banking_api_enduser, etc.) are correctly skipped.
const MANIFEST = scopeTopology._manifest();

const EXPECTED_SCOPES = (() => {
  const byAudience = {};
  for (const [name, res] of Object.entries(MANIFEST.resources || {})) {
    if (!res.uri) continue;
    byAudience[res.uri] = {
      description: name,
      requiredScopes: [...new Set([...(res.scopes || []), ...(res.mirroredScopes || [])])],
      optionalScopes: [],
    };
  }
  return byAudience;
})();

// Human-readable description for a scope, from the SSOT (falls back to a stub).
function scopeDescription(scope) {
  return (MANIFEST.scopes && MANIFEST.scopes[scope] && MANIFEST.scopes[scope].description) || `${scope} scope`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PingOne API Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getManagementToken(clientId, clientSecret, region = 'com', envId) {
  return new Promise((resolve, reject) => {
    const hostname = `auth.pingone.${region}`;
    const path = `/${envId}/as/token`;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            resolve(json.access_token);
          } else {
            reject(new Error(`No access_token in response: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write('grant_type=client_credentials&scope=p1:read:resource p1:read:resource_scope');
    req.end();
  });
}

async function listResources(envId, token, region = 'com') {
  return new Promise((resolve, reject) => {
    const hostname = `api.pingone.${region}`;
    const path = `/v1/environments/${envId}/resources`;

    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json._embedded?.resources || json.data || []);
        } catch (e) {
          reject(new Error(`Failed to parse resources response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function getResourceScopes(envId, resourceId, token, region = 'com') {
  return new Promise((resolve, reject) => {
    const hostname = `api.pingone.${region}`;
    const path = `/v1/environments/${envId}/resources/${resourceId}/scopes`;

    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json._embedded?.scopes || json.data || []);
        } catch (e) {
          reject(new Error(`Failed to parse scopes response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function createScope(envId, resourceId, scopeName, description, token, region = 'com') {
  return new Promise((resolve, reject) => {
    const hostname = `api.pingone.${region}`;
    const path = `/v1/environments/${envId}/resources/${resourceId}/scopes`;

    const payload = JSON.stringify({
      name: scopeName,
      description: description || `${scopeName} scope`,
    });

    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 201 || res.statusCode === 200) {
            const json = JSON.parse(data);
            resolve(json);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to create scope: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function listApplications(envId, token, region = 'com') {
  return new Promise((resolve, reject) => {
    const hostname = `api.pingone.${region}`;
    const path = `/v1/environments/${envId}/applications`;

    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json._embedded?.applications || json.data || []);
        } catch (e) {
          reject(new Error(`Failed to parse applications response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function getApplicationGrants(envId, applicationId, token, region = 'com') {
  return new Promise((resolve, reject) => {
    const hostname = `api.pingone.${region}`;
    const path = `/v1/environments/${envId}/applications/${applicationId}/grants`;

    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json._embedded?.grants || json.data || []);
        } catch (e) {
          reject(new Error(`Failed to parse grants response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// --manifest-diff: live PingOne vs scope-topology.json SSOT
// ─────────────────────────────────────────────────────────────────────────────

async function manifestDiff(token) {
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  const m = scopeTopology._manifest();
  let problems = 0;

  // SoT names are canonical ("Super Banking API"); PingOne provisions them under
  // the translated display names in provisioning.resourceNames / appNames
  // ("Demo API", "Demo AI App - User Login"). Translate before live lookup.
  const provResource = m.provisioning?.resourceNames || {};
  const provApp = m.provisioning?.appNames || {};
  const liveResourceName = (name) => provResource[name] || name;
  const liveAppName = (name) => provApp[name] || name;

  logInfo('Diffing live PingOne environment against scope-topology.json...');
  log('');

  // ── Resources ──────────────────────────────────────────────────────────────
  const liveResources = await listResources(envId, token, region);
  // Map resource server display name → live object (mirrors the --fix name map).
  const resourceByName = {};
  for (const r of liveResources) {
    if (r.name) resourceByName[r.name] = r;
  }
  // resourceId → live scope-name list, lazily fetched + cached for app diff reuse.
  const liveScopesByResourceId = {};
  async function liveScopesFor(resource) {
    if (!liveScopesByResourceId[resource.id]) {
      const scopes = await getResourceScopes(envId, resource.id, token, region);
      liveScopesByResourceId[resource.id] = scopes;
    }
    return liveScopesByResourceId[resource.id];
  }

  for (const resName of Object.keys(m.resources)) {
    const live = resourceByName[liveResourceName(resName)];
    if (!live) {
      log(`${COLORS.RED}✖ resource missing live: ${resName} (expected name "${liveResourceName(resName)}")${COLORS.RESET}`);
      problems++;
      continue;
    }
    const liveScopes = await liveScopesFor(live);
    const liveScopeNames = liveScopes.map(s => s.name);
    const expectedResScopes = [...new Set([
      ...(m.resources[resName].scopes || []),
      ...(m.resources[resName].mirroredScopes || []),
    ])];
    for (const scope of expectedResScopes) {
      if (!liveScopeNames.includes(scope)) {
        log(`${COLORS.RED}✖ ${resName} missing scope ${scope}${COLORS.RESET}`);
        problems++;
      }
    }
  }

  // ── Apps ───────────────────────────────────────────────────────────────────
  const liveApps = await listApplications(envId, token, region);
  const appByName = {};
  for (const a of liveApps) {
    if (a.name) appByName[a.name] = a;
  }

  for (const appName of Object.keys(m.apps)) {
    const liveApp = appByName[liveAppName(appName)];
    if (!liveApp) {
      log(`${COLORS.RED}✖ application missing live: ${appName} (expected name "${liveAppName(appName)}")${COLORS.RESET}`);
      problems++;
      continue;
    }

    const grants = await getApplicationGrants(envId, liveApp.id, token, region);
    // Resolve each grant's scope IDs → names via the owning resource's scope
    // list (PingOne grants carry resource.id + scopes[].id, not names).
    const grantedScopeNames = new Set();
    for (const g of grants) {
      const resId = g.resource?.id;
      if (!resId) continue;
      let resScopes = liveScopesByResourceId[resId];
      if (!resScopes) {
        resScopes = await getResourceScopes(envId, resId, token, region);
        liveScopesByResourceId[resId] = resScopes;
      }
      const idToName = new Map(resScopes.map(s => [s.id, s.name]));
      for (const s of (g.scopes || [])) {
        const n = idToName.get(s.id);
        if (n) grantedScopeNames.add(n);
      }
    }

    for (const scope of (m.apps[appName].grantedScopes || [])) {
      if (!grantedScopeNames.has(scope)) {
        log(`${COLORS.RED}✖ ${appName} not granted ${scope}${COLORS.RESET}`);
        problems++;
      }
    }
  }

  if (problems === 0) {
    log(`${COLORS.GREEN}✅ live PingOne matches scope-topology.json${COLORS.RESET}`);
  }

  return problems;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Verification Logic
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes('--fix');

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const clientId = process.env.PINGONE_MGMT_CLIENT_ID;
  const clientSecret = process.env.PINGONE_MGMT_CLIENT_SECRET;
  const region = process.env.PINGONE_REGION || 'com';

  // Validate inputs
  if (!envId) {
    logError('PINGONE_ENVIRONMENT_ID not set');
    process.exit(1);
  }

  if (!clientId || !clientSecret) {
    logError('PINGONE_MGMT_CLIENT_ID or PINGONE_MGMT_CLIENT_SECRET not set');
    log('To create a worker app in PingOne:');
    log('  Admin → Applications → Create Application (type: Worker)');
    log('  Copy Client ID and Secret into .env as PINGONE_MGMT_CLIENT_ID and PINGONE_MGMT_CLIENT_SECRET');
    process.exit(1);
  }

  if (shouldFix && !clientId) {
    logError('--fix requires PINGONE_MGMT_CLIENT_ID and PINGONE_MGMT_CLIENT_SECRET');
    process.exit(1);
  }

  logInfo(`Environment: ${envId}`);
  logInfo(`Region: ${region}`);
  logInfo('');

  // ── --manifest-diff: distinct mode, audits live PingOne vs SSOT, then exits ──
  if (process.argv.includes('--manifest-diff')) {
    try {
      logInfo('Authenticating with PingOne Management API...');
      const token = await getManagementToken(clientId, clientSecret, region, envId);
      logSuccess('Authentication successful');
      log('');
      const n = await manifestDiff(token);
      process.exit(n === 0 ? 0 : 1);
    } catch (e) {
      logError(`Fatal error: ${e.message}`);
      process.exit(1);
    }
  }

  try {
    // Step 1: Get management token
    logInfo('Authenticating with PingOne Management API...');
    const token = await getManagementToken(clientId, clientSecret, region, envId);
    logSuccess('Authentication successful');
    log('');

    // Step 2: List all resources
    logInfo('Fetching PingOne resources...');
    const resources = await listResources(envId, token, region);
    logSuccess(`Found ${resources.length} resources`);
    log('');

    // Step 3: For each resource, list scopes and check against expected
    let totalIssues = 0;
    let resourceMap = {};

    for (const resource of resources) {
      const resourceId = resource.id;
      const resourceName = resource.name || '(unnamed)';
      // PingOne returns 'audience' for custom resources, not 'uri'
      const resourceUri = resource.audience || resource.uri || null;

      logInfo(`Checking: ${resourceName} (${resourceUri || 'no audience'})`);

      try {
        const scopes = await getResourceScopes(envId, resourceId, token, region);
        const scopeNames = scopes.map(s => s.name);

        const mapKey = resourceUri || resourceName;
        resourceMap[mapKey] = {
          id: resourceId,
          name: resourceName,
          audience: resourceUri,
          scopes: scopeNames,
        };

        // Match against the SSOT by EXACT audience (uri). Legacy/duplicate
        // resources whose audience is not in scope-topology.json are skipped.
        const expected = resourceUri ? EXPECTED_SCOPES[resourceUri] : null;
        if (expected) {
          const { requiredScopes, optionalScopes, description } = expected;

          log(`  ${COLORS.BLUE}Description:${COLORS.RESET} ${description}`);
          log(`  ${COLORS.BLUE}Audience:${COLORS.RESET}    ${resourceUri || '(none)'}`);
          log(`  ${COLORS.BLUE}Resource ID:${COLORS.RESET} ${resourceId}`);
          log(`  ${COLORS.BLUE}Scopes (${scopeNames.length}):${COLORS.RESET} ${scopeNames.length > 0 ? scopeNames.join(', ') : '(none)'}`);

          const missingRequired = requiredScopes.filter(s => !scopeNames.includes(s));
          const missingOptional = optionalScopes.filter(s => !scopeNames.includes(s));

          if (missingRequired.length > 0) {
            logWarn(`  Missing REQUIRED scopes: ${missingRequired.join(', ')}`);
            totalIssues++;

            if (shouldFix) {
              logInfo(`  Attempting to create missing scopes...`);
              for (const scope of missingRequired) {
                try {
                  await createScope(envId, resourceId, scope, scopeDescription(scope), token, region);
                  logSuccess(`    Created scope: ${scope}`);
                } catch (e) {
                  logError(`    Failed to create scope ${scope}: ${e.message}`);
                }
              }
            }
          } else {
            logSuccess(`  All required scopes present`);
          }

          if (missingOptional.length > 0) {
            logWarn(`  Missing OPTIONAL scopes: ${missingOptional.join(', ')}`);
            if (!shouldFix) {
              logInfo(`  (Run with --fix to auto-create)`);
            }
          }
        } else {
          log(`  ${COLORS.BLUE}Audience:${COLORS.RESET}    ${resourceUri || '(none)'}`);
          log(`  ${COLORS.BLUE}Scopes (${scopeNames.length}):${COLORS.RESET} ${scopeNames.length > 0 ? scopeNames.join(', ') : '(none)'}`);
          logInfo(`  (No expected configuration matched; skipping validation)`);
        }

        log('');
      } catch (e) {
        logError(`Failed to get scopes for ${resourceName}: ${e.message}`);
        totalIssues++;
      }
    }

    // Step 4: Summary
    log('');
    log('═'.repeat(70));
    if (totalIssues === 0) {
      logSuccess('✅ All scope configurations are correct!');
    } else {
      logWarn(`⚠️  Found ${totalIssues} issue(s) with scope configuration`);
    }
    log('═'.repeat(70));

    // Step 5: Output resource map for configStore
    log('');
    logInfo('Resource Configuration Summary:');
    log('');
    for (const [key, info] of Object.entries(resourceMap)) {
      log(`  Resource: ${info.name}`);
      log(`    Audience: ${info.audience || '(none)'}`);
      log(`    ID: ${info.id}`);
      log(`    Scopes: ${info.scopes.join(', ') || '(none)'}`);
      log('');
    }

    process.exit(totalIssues > 0 ? 1 : 0);
  } catch (e) {
    logError(`Fatal error: ${e.message}`);
    process.exit(1);
  }
}

// Run
main();
