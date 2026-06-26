'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const { getManagementToken } = require('./pingOneClientService');
const { getAdminRedirectUri, getUserRedirectUri, getFrontendOrigin } = require('./oauthRedirectUris');
const { KNOWN_REDIRECT_ORIGINS } = require('./knownRedirectOrigins');
const appEventService = require('./appEventService');

// Periodic re-check interval — every 30 minutes. Catches manual PingOne drift
// (someone removing a URI) without requiring a restart.
const RECHECK_INTERVAL_MS = 30 * 60 * 1000;

function getBaseUrl() {
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  if (!envId) throw new Error('PINGONE_ENVIRONMENT_ID not configured');
  return 'https://api.pingone.' + region + '/v1/environments/' + envId;
}

/**
 * Get PingOne application configuration by app ID.
 */
async function getAppConfig(appId) {
  const token = await getManagementToken();
  const baseUrl = getBaseUrl();
  const res = await axios.get(baseUrl + '/applications/' + appId, {
    headers: { Authorization: 'Bearer ' + token },
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
  const res = await axios.put(baseUrl + '/applications/' + appId, config, {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
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
    url + '/login',
    'https://demo-api-server:3001',
  ];
  const uniqueUrls = Array.from(new Set(logoutUrls));

  const before = {
    postLogoutRedirectUris: current.postLogoutRedirectUris || [],
    signOffUrl: current.signOffUrl || null
  };

  const existing = new Set(current.postLogoutRedirectUris || []);
  for (var i = 0; i < uniqueUrls.length; i++) existing.add(uniqueUrls[i]);

  const updated = Object.assign({}, current, { postLogoutRedirectUris: Array.from(existing) });
  if (!current.signOffUrl) updated.signOffUrl = url;

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

  if (!config.postLogoutRedirectUris || config.postLogoutRedirectUris.length === 0) {
    issues.push({ check: 'postLogoutRedirectUris', severity: 'error', message: 'No logout redirect URIs configured — logout will fail silently' });
  } else {
    passes.push({ check: 'postLogoutRedirectUris', message: config.postLogoutRedirectUris.length + ' logout URIs configured' });
  }

  if (!config.redirectUris || config.redirectUris.length === 0) {
    issues.push({ check: 'redirectUris', severity: 'error', message: 'No redirect URIs configured' });
  } else {
    passes.push({ check: 'redirectUris', message: config.redirectUris.length + ' redirect URIs configured' });
  }

  if (config.pkceEnforcement !== 'S256_REQUIRED') {
    issues.push({ check: 'pkce', severity: 'warning', message: 'PKCE enforcement is "' + (config.pkceEnforcement || 'not set') + '" — should be S256_REQUIRED' });
  } else {
    passes.push({ check: 'pkce', message: 'PKCE S256 required ✓' });
  }

  if (config.grantTypes && !config.grantTypes.includes('AUTHORIZATION_CODE')) {
    issues.push({ check: 'grantTypes', severity: 'error', message: 'AUTHORIZATION_CODE grant not enabled' });
  } else {
    passes.push({ check: 'grantTypes', message: 'AUTHORIZATION_CODE grant enabled ✓' });
  }

  if (config.tokenEndpointAuthMethod === 'NONE') {
    issues.push({ check: 'tokenEndpointAuth', severity: 'warning', message: 'Token endpoint auth is NONE — should use CLIENT_SECRET_BASIC' });
  } else {
    passes.push({ check: 'tokenEndpointAuth', message: 'Token endpoint auth: ' + (config.tokenEndpointAuthMethod || 'default') + ' ✓' });
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
    healthy: issues.filter(function (i) { return i.severity === 'error'; }).length === 0
  };
}

/**
 * Ensure a redirect URI is registered on a PingOne application.
 */
async function ensureRedirectUri(appId, redirectUri) {
  if (!appId || !redirectUri) {
    return { appId, redirectUri, error: 'appId and redirectUri are required' };
  }
  var config;
  try {
    config = await getAppConfig(appId);
  } catch (err) {
    return { appId, redirectUri, error: 'getAppConfig failed: ' + err.message };
  }

  const existing = new Set(config.redirectUris || []);
  if (existing.has(redirectUri)) {
    return { appId, redirectUri, alreadyPresent: true, uriCount: existing.size };
  }

  existing.add(redirectUri);
  const updated = Object.assign({}, config, { redirectUris: Array.from(existing) });
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
    return { appId, redirectUri, error: 'updateAppConfig failed: ' + err.message };
  }
}

// KNOWN_REDIRECT_ORIGINS imported from knownRedirectOrigins.js — single source of truth.

/**
 * Ensure all required redirect URIs are registered on a single PingOne app.
 * Fetches the app once, merges missing URIs, issues one PUT if needed, then
 * re-reads the app to verify the write actually landed.
 */
async function ensureAllUrisOnApp(appId, requiredUris, label) {
  var config;
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
    await updateAppConfig(appId, updated);
    console.log('[redirect-uri-guard] ' + label + ' (' + appId.slice(0, 8) + '…) — added ' + missing.length + ' URI(s): ' + missing.join(', '));
  } catch (err) {
    return { appId, label, error: 'updateAppConfig failed: ' + err.message };
  }

  // Verify the write actually landed — re-read and confirm each required URI is present.
  var verified;
  try {
    verified = await getAppConfig(appId);
  } catch (err) {
    return { appId, label, added: missing, verifyError: 'could not re-read after write: ' + err.message };
  }
  const verifiedSet = new Set(verified.redirectUris || []);
  const stillMissing = requiredUris.filter(function (u) { return !verifiedSet.has(u); });
  if (stillMissing.length > 0) {
    console.warn('[redirect-uri-guard] ' + label + ' — write appeared to succeed but URI(s) not confirmed in re-read: ' + stillMissing.join(', '));
    return { appId, label, added: missing, verifyFailed: stillMissing, newUriCount: verifiedSet.size };
  }

  return { appId, label, added: missing, verified: true, newUriCount: verifiedSet.size };
}

/**
 * Ensure logout URIs (postLogoutRedirectUris) are registered on a single PingOne app.
 * Fetches, merges, writes if needed, then verifies.
 */
async function ensureLogoutUrisOnApp(appId, requiredUris, label) {
  var config;
  try {
    config = await getAppConfig(appId);
  } catch (err) {
    return { appId, label, error: 'getAppConfig failed: ' + err.message };
  }

  const existing = new Set(config.postLogoutRedirectUris || []);
  const missing = requiredUris.filter(function (u) { return !existing.has(u); });

  if (missing.length === 0) {
    console.log('[logout-uri-guard] ' + label + ' (' + appId.slice(0, 8) + '…) — all ' + existing.size + ' logout URI(s) already present');
    return { appId, label, alreadyPresent: true, uriCount: existing.size };
  }

  missing.forEach(function (u) { existing.add(u); });
  const updated = Object.assign({}, config, { postLogoutRedirectUris: Array.from(existing) });
  if (!config.signOffUrl) updated.signOffUrl = requiredUris[0];

  try {
    await updateAppConfig(appId, updated);
    console.log('[logout-uri-guard] ' + label + ' (' + appId.slice(0, 8) + '…) — added ' + missing.length + ' logout URI(s): ' + missing.join(', '));
  } catch (err) {
    return { appId, label, error: 'updateAppConfig failed: ' + err.message };
  }

  // Verify
  var verified;
  try {
    verified = await getAppConfig(appId);
  } catch (err) {
    return { appId, label, added: missing, verifyError: 'could not re-read after write: ' + err.message };
  }
  const verifiedSet = new Set(verified.postLogoutRedirectUris || []);
  const stillMissing = requiredUris.filter(function (u) { return !verifiedSet.has(u); });
  if (stillMissing.length > 0) {
    console.warn('[logout-uri-guard] ' + label + ' — write appeared to succeed but logout URI(s) not confirmed: ' + stillMissing.join(', '));
    return { appId, label, added: missing, verifyFailed: stillMissing, newUriCount: verifiedSet.size };
  }

  return { appId, label, added: missing, verified: true, newUriCount: verifiedSet.size };
}

/**
 * Ensure both admin and user redirect URIs AND logout URIs are registered in PingOne.
 *
 * - Uses getAdminRedirectUri()/getUserRedirectUri() so guard and routes share one source of truth.
 * - Covers all KNOWN_REDIRECT_ORIGINS so the tenant works across all deployments.
 * - Verifies every write by re-reading the app after patching.
 * - Ensures postLogoutRedirectUris so logout never breaks silently.
 * - Writes results to the disk activity log.
 * - Never throws.
 *
 * @returns {Promise<{ admin: object, user: object, adminLogout: object, userLogout: object }>}
 */
async function ensureAllRedirectUris() {
  const liveAdminUri = getAdminRedirectUri(null);
  const liveUserUri  = getUserRedirectUri(null);
  const frontendOrigin = getFrontendOrigin();

  const adminUris = Array.from(new Set(
    KNOWN_REDIRECT_ORIGINS.map(function (o) { return o + '/api/auth/oauth/callback'; })
      .concat([liveAdminUri])
  ));
  const userUris = Array.from(new Set(
    KNOWN_REDIRECT_ORIGINS.map(function (o) { return o + '/api/auth/oauth/user/callback'; })
      .concat([liveUserUri])
  ));

  // Logout URIs: all known origins + live frontend + /logout suffix
  const logoutUris = Array.from(new Set(
    KNOWN_REDIRECT_ORIGINS
      .concat([frontendOrigin])
      .map(function (o) { return o + '/logout'; })
  ));

  const adminClientId = configStore.getEffective('admin_client_id') || null;
  const userClientId  = configStore.getEffective('user_client_id')  || null;

  var results = { admin: null, user: null, adminLogout: null, userLogout: null };

  if (adminClientId) {
    results.admin = await ensureAllUrisOnApp(adminClientId, adminUris, 'admin');
    if (results.admin.error) console.warn('[redirect-uri-guard] admin WARN:', results.admin.error);
    if (results.admin.verifyFailed) console.warn('[redirect-uri-guard] admin verify WARN: URIs not confirmed after write');

    results.adminLogout = await ensureLogoutUrisOnApp(adminClientId, logoutUris, 'admin');
    if (results.adminLogout.error) console.warn('[logout-uri-guard] admin WARN:', results.adminLogout.error);
  } else {
    results.admin = { skipped: true, reason: 'admin_client_id not configured' };
    results.adminLogout = { skipped: true, reason: 'admin_client_id not configured' };
    console.log('[redirect-uri-guard] admin: skipped — admin_client_id not configured');
  }

  if (userClientId) {
    results.user = await ensureAllUrisOnApp(userClientId, userUris, 'user');
    if (results.user.error) console.warn('[redirect-uri-guard] user WARN:', results.user.error);
    if (results.user.verifyFailed) console.warn('[redirect-uri-guard] user verify WARN: URIs not confirmed after write');

    results.userLogout = await ensureLogoutUrisOnApp(userClientId, logoutUris, 'user');
    if (results.userLogout.error) console.warn('[logout-uri-guard] user WARN:', results.userLogout.error);
  } else {
    results.user = { skipped: true, reason: 'user_client_id not configured' };
    results.userLogout = { skipped: true, reason: 'user_client_id not configured' };
    console.log('[redirect-uri-guard] user: skipped — user_client_id not configured');
  }

  const anyError = [results.admin, results.user, results.adminLogout, results.userLogout]
    .some(function (r) { return r && (r.error || r.verifyFailed); });
  const severity = anyError ? 'warn' : 'info';

  appEventService.logEvent('oauth', severity, 'redirect-uri-guard completed', {
    tag: 'startup/redirect-uri-guard',
    liveAdminUri: liveAdminUri,
    liveUserUri: liveUserUri,
    admin: results.admin,
    user: results.user,
    adminLogout: results.adminLogout,
    userLogout: results.userLogout,
  });

  return results;
}

/**
 * Start a periodic background re-check of redirect and logout URIs.
 * Catches manual drift in PingOne without requiring a restart.
 * Returns a handle with a stop() method.
 */
function startRedirectUriScheduler() {
  const interval = setInterval(function () {
    console.log('[redirect-uri-guard] Periodic re-check...');
    ensureAllRedirectUris().catch(function (err) {
      console.warn('[redirect-uri-guard] Periodic re-check failed:', err.message);
    });
  }, RECHECK_INTERVAL_MS);

  // Don't hold the process open if nothing else is running.
  if (interval.unref) interval.unref();

  console.log('[redirect-uri-guard] Periodic re-check scheduled every ' + (RECHECK_INTERVAL_MS / 60000) + ' min');
  return { stop: function () { clearInterval(interval); } };
}

module.exports = {
  getAppConfig,
  updateAppConfig,
  fixLogoutUrls,
  auditAppConfig,
  ensureRedirectUri,
  ensureAllUrisOnApp,
  ensureAllRedirectUris,
  startRedirectUriScheduler,
};
