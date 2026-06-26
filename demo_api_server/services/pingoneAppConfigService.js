'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const { getManagementToken } = require('./pingOneClientService');
const { getAdminRedirectUri, getUserRedirectUri } = require('./oauthRedirectUris');
const { KNOWN_REDIRECT_ORIGINS } = require('./knownRedirectOrigins');
const appEventService = require('./appEventService');

function getBaseUrl() {
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  if (!envId) throw new Error('PINGONE_ENVIRONMENT_ID not configured');
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

/**
 * Get PingOne application configuration by app ID.
 */
async function getAppConfig(appId) {
  const token = await getManagementToken();
  const baseUrl = getBaseUrl();
  const res = await axios.get(`${baseUrl}/applications/${appId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000
  });
  return res.data;
}

/**
 * Update PingOne application configuration (PUT — full replace).
 */
async function updateAppConfig(appId, config) {
  const token = await getManagementToken();
  const baseUrl = getBaseUrl();
  const res = await axios.put(`${baseUrl}/applications/${appId}`, config, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  return res.data;
}

/**
 * Fix logout URLs on a PingOne application.
 * Adds postLogoutRedirectUris so RP-initiated logout works.
 */
async function fixLogoutUrls(appId, publicAppUrl) {
  const current = await getAppConfig(appId);
  const url = publicAppUrl || configStore.getEffective('public_app_url') || 'https://demo-api-server:3001';

  const logoutUrls = [
    url,
    `${url}/login`,
    'https://demo-api-server:3001',
  ];
  // Deduplicate
  const uniqueUrls = [...new Set(logoutUrls)];

  const before = {
    postLogoutRedirectUris: current.postLogoutRedirectUris || [],
    signOffUrl: current.signOffUrl || null
  };

  // Merge — keep existing, add missing
  const existing = new Set(current.postLogoutRedirectUris || []);
  for (const u of uniqueUrls) existing.add(u);

  const updated = { ...current, postLogoutRedirectUris: [...existing] };
  // signOffUrl is a single string in PingOne — set to primary
  if (!current.signOffUrl) {
    updated.signOffUrl = url;
  }

  const after = await updateAppConfig(appId, updated);

  return {
    appId,
    appName: current.name,
    before,
    after: {
      postLogoutRedirectUris: after.postLogoutRedirectUris || [],
      signOffUrl: after.signOffUrl || null
    },
    changed: true
  };
}

/**
 * Audit a PingOne app for common configuration issues.
 */
async function auditAppConfig(appId) {
  const config = await getAppConfig(appId);
  const issues = [];
  const passes = [];

  // Check logout URLs
  if (!config.postLogoutRedirectUris || config.postLogoutRedirectUris.length === 0) {
    issues.push({ check: 'postLogoutRedirectUris', severity: 'error', message: 'No logout redirect URIs configured — logout will fail silently' });
  } else {
    passes.push({ check: 'postLogoutRedirectUris', message: `${config.postLogoutRedirectUris.length} logout URIs configured` });
  }

  // Check redirect URIs
  if (!config.redirectUris || config.redirectUris.length === 0) {
    issues.push({ check: 'redirectUris', severity: 'error', message: 'No redirect URIs configured' });
  } else {
    const hasLocalhost = config.redirectUris.some(u => u.includes('localhost'));
    if (!hasLocalhost) {
      issues.push({ check: 'redirectUris', severity: 'warning', message: 'No api.ping.demo redirect URIs — ensure PingOne app lists https://api.ping.demo:3001 redirect URIs' });
    } else {
      passes.push({ check: 'redirectUris', message: `${config.redirectUris.length} redirect URIs configured` });
    }
  }

  // Check PKCE
  if (config.pkceEnforcement !== 'S256_REQUIRED') {
    issues.push({ check: 'pkce', severity: 'warning', message: `PKCE enforcement is "${config.pkceEnforcement || 'not set'}" — should be S256_REQUIRED` });
  } else {
    passes.push({ check: 'pkce', message: 'PKCE S256 required ✓' });
  }

  // Check grant types
  if (config.grantTypes && !config.grantTypes.includes('AUTHORIZATION_CODE')) {
    issues.push({ check: 'grantTypes', severity: 'error', message: 'AUTHORIZATION_CODE grant not enabled' });
  } else {
    passes.push({ check: 'grantTypes', message: 'AUTHORIZATION_CODE grant enabled ✓' });
  }

  // Check token endpoint auth method
  if (config.tokenEndpointAuthMethod === 'NONE') {
    issues.push({ check: 'tokenEndpointAuth', severity: 'warning', message: 'Token endpoint auth is NONE — should use CLIENT_SECRET_BASIC' });
  } else {
    passes.push({ check: 'tokenEndpointAuth', message: `Token endpoint auth: ${config.tokenEndpointAuthMethod || 'default'} ✓` });
  }

  return {
    appId,
    appName: config.name,
    appType: config.type,
    enabled: config.enabled,
    issues,
    passes,
    issueCount: issues.length,
    passCount: passes.length,
    healthy: issues.filter(i => i.severity === 'error').length === 0
  };
}


/**
 * Ensure a redirect URI is registered on a PingOne application.
 * If already present, returns alreadyPresent=true (no-op).
 * If missing, PATCHes the app via PUT (full-replace merging existing + new) and returns added=true.
 *
 * Uses the existing management token from getManagementToken() — silent client_credentials grant.
 *
 * @param {string} appId - PingOne application ID (client_id of the OAuth app)
 * @param {string} redirectUri - The redirect URI that must be registered (must include port if non-standard)
 * @returns {Promise<{appId, redirectUri, alreadyPresent?, added?, error?, newUriCount?}>}
 */
async function ensureRedirectUri(appId, redirectUri) {
  if (!appId || !redirectUri) {
    return { appId, redirectUri, error: 'appId and redirectUri are required' };
  }
  let config;
  try {
    config = await getAppConfig(appId);
  } catch (err) {
    return { appId, redirectUri, error: `getAppConfig failed: ${err.message}` };
  }

  const existing = new Set(config.redirectUris || []);
  if (existing.has(redirectUri)) {
    return { appId, redirectUri, alreadyPresent: true, uriCount: existing.size };
  }

  existing.add(redirectUri);
  const updated = { ...config, redirectUris: [...existing] };
  try {
    const after = await updateAppConfig(appId, updated);
    return {
      appId,
      redirectUri,
      added: true,
      newUriCount: (after.redirectUris || []).length,
      appName: config.name,
    };
  } catch (err) {
    return { appId, redirectUri, error: `updateAppConfig failed: ${err.message}` };
  }
}

// KNOWN_REDIRECT_ORIGINS imported from knownRedirectOrigins.js — single source of truth.

/**
 * Ensure all required redirect URIs are registered on a single PingOne app.
 * Fetches the app once, merges the needed URIs, and issues one PUT only if
 * anything is missing. Returns a summary object.
 *
 * @param {string} appId
 * @param {string[]} requiredUris
 * @param {string} label - for logging ('admin' | 'user')
 */
async function ensureAllUrisOnApp(appId, requiredUris, label) {
  let config;
  try {
    config = await getAppConfig(appId);
  } catch (err) {
    return { appId, label, error: 'getAppConfig failed: ' + err.message };
  }

  const existing = new Set(config.redirectUris || []);
  const missing = requiredUris.filter(function (u) { return !existing.has(u); });

  if (missing.length === 0) {
    console.log('[redirect-uri-guard] ' + label + ' (' + appId.slice(0, 8) + '…) — all ' + existing.size + ' URI(s) already present');
    return { appId, label, alreadyPresent: true, uriCount: existing.size };
  }

  missing.forEach(function (u) { existing.add(u); });
  const updated = Object.assign({}, config, { redirectUris: Array.from(existing) });
  try {
    const after = await updateAppConfig(appId, updated);
    console.log('[redirect-uri-guard] ' + label + ' (' + appId.slice(0, 8) + '…) — added ' + missing.length + ' URI(s): ' + missing.join(', '));
    return { appId, label, added: missing, newUriCount: (after.redirectUris || []).length };
  } catch (err) {
    return { appId, label, error: 'updateAppConfig failed: ' + err.message };
  }
}

/**
 * Ensure both admin and user redirect URIs are registered in PingOne.
 *
 * Uses getAdminRedirectUri()/getUserRedirectUri() — the exact same functions
 * the auth routes call — so the guard and the routes can never derive different URIs.
 * Also registers all KNOWN_REDIRECT_ORIGINS so the tenant works across all deployments.
 * Writes results to the disk activity log. Never throws.
 *
 * @returns {Promise<{ admin: object, user: object }>}
 */
async function ensureAllRedirectUris() {
  // Derive the live URIs the same way the auth routes do — single source of truth.
  const liveAdminUri = getAdminRedirectUri(null);
  const liveUserUri  = getUserRedirectUri(null);

  // Build full sets: all known origins + whatever the live routes will actually send.
  const adminUris = Array.from(new Set(
    KNOWN_REDIRECT_ORIGINS.map(function (o) { return o + '/api/auth/oauth/callback'; })
      .concat([liveAdminUri])
  ));
  const userUris = Array.from(new Set(
    KNOWN_REDIRECT_ORIGINS.map(function (o) { return o + '/api/auth/oauth/user/callback'; })
      .concat([liveUserUri])
  ));

  const adminClientId = configStore.getEffective('admin_client_id') || null;
  const userClientId  = configStore.getEffective('user_client_id')  || null;

  var results = { admin: null, user: null };

  if (adminClientId) {
    results.admin = await ensureAllUrisOnApp(adminClientId, adminUris, 'admin');
    if (results.admin.error) {
      console.warn('[redirect-uri-guard] admin WARN:', results.admin.error);
    }
  } else {
    results.admin = { skipped: true, reason: 'admin_client_id not configured' };
    console.log('[redirect-uri-guard] admin: skipped — admin_client_id not configured');
  }

  if (userClientId) {
    results.user = await ensureAllUrisOnApp(userClientId, userUris, 'user');
    if (results.user.error) {
      console.warn('[redirect-uri-guard] user WARN:', results.user.error);
    }
  } else {
    results.user = { skipped: true, reason: 'user_client_id not configured' };
    console.log('[redirect-uri-guard] user: skipped — user_client_id not configured');
  }

  // Write result to disk activity log so startup state is always auditable.
  var severity = (results.admin && results.admin.error) || (results.user && results.user.error) ? 'warn' : 'info';
  appEventService.logEvent('oauth', severity, 'redirect-uri-guard completed', {
    tag: 'startup/redirect-uri-guard',
    liveAdminUri: liveAdminUri,
    liveUserUri: liveUserUri,
    admin: results.admin,
    user: results.user,
  });

  return results;
}

module.exports = {
  getAppConfig,
  updateAppConfig,
  fixLogoutUrls,
  auditAppConfig,
  ensureRedirectUri,
  ensureAllUrisOnApp,
  ensureAllRedirectUris,
};
