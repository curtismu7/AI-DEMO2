/**
 * pingoneClientSecretPreflight.js
 *
 * Boot-time validation that the secrets this app STORES for its PingOne OAuth
 * clients match what PingOne actually has. The rotation incident this guards
 * against: a credential is rotated server-side (console or API) but the
 * configStore keeps the stale value — every login then fails with
 * invalid_client at the token endpoint, an error that surfaces only during a
 * user's browser flow and looks transient.
 *
 * How it validates without minting tokens: the management worker can READ each
 * application's secret (GET /applications/{id}/secret). A plain comparison of
 * stored-vs-PingOne catches rotation drift deterministically — no grant-type
 * gymnastics needed for WEB_APP login clients that do not hold
 * client_credentials.
 *
 * Always resolves (never throws). Default warn-and-continue;
 * PINGONE_PREFLIGHT_STRICT=true makes a mismatch fatal at boot.
 * Opt out entirely: PINGONE_CLIENT_SECRET_PREFLIGHT=false.
 */
'use strict';

const axios = require('axios');
const configStore = require('./configStore');

const TAG = '[client-secret-preflight]';

function flag(key, def) {
  const v = configStore.getEffective(key);
  return v === undefined || v === null || v === '' ? def : String(v).toLowerCase();
}

/**
 * @returns {Promise<{ ok:boolean, code:string, message:string, skipped?:boolean, fatal?:boolean }>}
 */
async function runClientSecretPreflight() {
  try {
    if (typeof configStore.ensureInitialized === 'function') {
      await configStore.ensureInitialized();
    }
  } catch (_) { /* the checks below report the real verdict */ }

  if (flag('pingone_client_secret_preflight', 'true') === 'false') {
    return { ok: true, code: 'disabled', message: 'preflight disabled', skipped: true };
  }
  const strict = flag('pingone_preflight_strict', 'false') === 'true';
  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const clientId = configStore.getEffective('PINGONE_WORKER_CLIENT_ID');
  const clientSecret = configStore.getEffective('PINGONE_WORKER_CLIENT_SECRET');
  if (!envId || !clientId || !clientSecret) {
    return { ok: true, code: 'no_credentials', message: 'no worker credentials', skipped: true };
  }

  // The management worker token: same resolution as getManagementToken().
  let workerToken;
  try {
    const r = await axios.post(
      `https://auth.pingone.com/${envId}/as/token`,
      'grant_type=client_credentials',
      { auth: { username: clientId, password: clientSecret }, timeout: 15000 },
    );
    workerToken = r.data.access_token;
  } catch (_err) {
    // The worker preflight already reports this class of failure with a full
    // verdict — stay quiet here to avoid double-logging one root cause.
    return { ok: true, code: 'worker_unavailable', message: 'worker token unavailable', skipped: true };
  }

  // (configKey, envAlias) pairs: the login apps whose stored secrets matter.
  const CHECKS = [
    ['admin_client_secret', 'PINGONE_ADMIN_CLIENT_ID', 'admin'],
    ['user_client_secret', 'PINGONE_USER_CLIENT_ID', 'user'],
  ];

  let mismatches = 0;
  for (const [secretKey, idKey, label] of CHECKS) {
    const appId = configStore.getEffective(idKey);
    const stored = configStore.getEffective(secretKey);
    if (!appId || !stored) continue; // not configured — nothing to validate
    try {
      const r = await axios.get(
        `https://api.pingone.com/v1/environments/${envId}/applications/${appId}/secret`,
        { headers: { Authorization: `Bearer ${workerToken}` }, timeout: 15000 },
      );
      const actual = r.data.secret || '';
      if (actual && actual !== stored) {
        mismatches += 1;
        console.warn(
          `${TAG} ⚠️  ${label} client (...${String(appId).slice(-8)}) secret DRIFT: ` +
          `stored ${secretKey} does not match PingOne. If you rotated this credential, ` +
          `update it via App Configuration or run: configStore.set("${secretKey}", newValue).`,
        );
      } else if (actual) {
        console.log(`${TAG} ✅ ${label} client (...${String(appId).slice(-8)}) secret matches stored value.`);
      }
    } catch (err) {
      const status = err?.response?.status;
      // 403 = worker lacks secret-read entitlement — skip silently (can't check).
      if (status === 403) continue;
      if (status === 404) {
        mismatches += 1;
        console.warn(`${TAG} ⚠️  ${label} client id (...${String(appId).slice(-8)}) not found in PingOne — ${idKey} is stale.`);
        continue;
      }
      // Transient network or other error — never block boot on it.
      console.warn(`${TAG} check skipped for ${label} client: ${err.message}`);
    }
  }

  if (mismatches > 0) {
    return { ok: false, code: 'secret_drift', message: `${mismatches} client secret(s) drifted`, fatal: strict };
  }
  return { ok: true, code: 'healthy', message: 'ok' };
}

module.exports = { runClientSecretPreflight };
