'use strict';

/**
 * The embedded (response_mode=pi.flow) sign-in on /sdk-login depends on a
 * PingOne setting nothing provisions (TECH_DEBT 2026-09-14): the PKCE app's
 * `corsSettings` must be ALLOW_SPECIFIC_ORIGINS and list every browser origin
 * the demo is served from. With `corsSettings: null`, GET /as/resume returns
 * the code with no Access-Control-Allow-Origin, the browser cannot read it, and
 * the failure looks like a bad password. A re-created app comes back null.
 *
 * READ-ONLY: one worker token request and one GET of the application. This
 * check never writes to PingOne; the remedy is an operator action.
 *
 * `behavior` is ALLOW_NO_ORIGINS | ALLOW_SPECIFIC_ORIGINS — PingOne has no
 * allow-all value (terraform-provider-pingone docs/resources/application.md,
 * cors_settings). An origin entry may wildcard a subdomain with `*`.
 */

const configStore = require('../configStore');
const { pingOneManagementAccess, managementApiBase } = require('../demoReadinessPingOneReader');
const { KNOWN_PUBLIC_ORIGINS } = require('../oauthRedirectUris');
const { normalizeAxiosError } = require('../../utils/normalizeAxiosError');
const { register } = require('./registry');

const TIMEOUT_MS = 8000;
const WORKER_KEYS = ['PINGONE_ENVIRONMENT_ID', 'PINGONE_WORKER_CLIENT_ID', 'PINGONE_WORKER_CLIENT_SECRET'];

function toOrigin(value) {
  try { return new URL(String(value).trim()).origin; } catch { return null; }
}

/** Browser origins this deployment serves the UI from, from config the BFF already has. */
function servedOrigins(env) {
  const raw = [
    ...KNOWN_PUBLIC_ORIGINS,
    configStore.getEffective('PUBLIC_APP_URL') || env.PUBLIC_APP_URL,
    ...String(env.CORS_ORIGIN || '').split(','),
  ];
  return [...new Set(raw.map(toOrigin).filter((origin) => origin && origin !== 'null'))];
}

/** True when a PingOne origin entry (optionally `*` in the host) covers `origin`. */
function covers(entry, origin) {
  const pattern = String(entry).trim().replace(/\/+$/, '');
  if (!pattern.includes('*')) return toOrigin(pattern) === origin;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^./:]*');
  return new RegExp('^' + escaped + '$', 'i').test(origin);
}

/** A code or name only — never err.message, which can carry request material. */
function safeReason(err) {
  const normalized = normalizeAxiosError(err, { label: 'PingOne Management API', timeoutMs: TIMEOUT_MS });
  return normalized.code || err?.cause?.code || err?.name || 'unknown error';
}

async function runPkceAppCorsCheck({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const appId = String(configStore.getEffective('pingone_sdk_demo_client_id') || '').trim();
  if (!appId) {
    return {
      status: 'warn',
      detail: 'cannot check: the /sdk-login PKCE app id is unknown (PINGONE_SDK_DEMO_CLIENT_ID is not set)',
      nextAction: 'Set PINGONE_SDK_DEMO_CLIENT_ID to the client id of the PingOne app "Demo AI App - PKCE".',
    };
  }
  const unset = WORKER_KEYS.filter((key) => !env[key]);
  if (unset.length) {
    return {
      status: 'warn',
      detail: `cannot check: PingOne worker credentials are not configured (${unset.join(', ')})`,
      nextAction: 'Set the Management API worker credentials so the BFF can read the app, or verify corsSettings on the app by hand.',
      meta: { unset },
    };
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let app;
  try {
    const { token } = await pingOneManagementAccess({ env, fetchImpl, signal });
    const response = await fetchImpl(managementApiBase(env) + '/applications/' + encodeURIComponent(appId), {
      method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal,
    });
    if (!response.ok) {
      return {
        status: 'warn',
        detail: `cannot check: PingOne answered HTTP ${response.status} reading application ${appId}`,
        nextAction: response.status === 404
          ? 'PINGONE_SDK_DEMO_CLIENT_ID names an app this environment does not have — /sdk-login cannot sign in at all until it does.'
          : 'Check that the worker app can read applications in this environment.',
      };
    }
    app = await response.json();
  } catch (err) {
    return {
      status: 'warn',
      detail: `cannot check: reading application ${appId} from PingOne failed (${safeReason(err)})`,
    };
  }

  const served = servedOrigins(env);
  const cors = app.corsSettings;
  const listed = cors?.behavior === 'ALLOW_SPECIFIC_ORIGINS' && Array.isArray(cors.origins) ? cors.origins : [];
  const missing = served.filter((origin) => !listed.some((entry) => covers(entry, origin)));
  if (!missing.length) {
    return {
      status: 'pass',
      detail: `corsSettings ALLOW_SPECIFIC_ORIGINS lists all ${served.length} served origins`,
      meta: { served, missing },
    };
  }

  const appLabel = `"${app.name || 'Demo AI App - PKCE'}" (${appId})`;
  return {
    status: 'fail',
    detail: !cors
      ? 'corsSettings is not set on the PKCE app — the embedded sign-in on /sdk-login fails at /as/resume and reads like a bad password'
      : cors.behavior !== 'ALLOW_SPECIFIC_ORIGINS'
        ? `corsSettings.behavior is ${cors.behavior}, not ALLOW_SPECIFIC_ORIGINS — the embedded sign-in on /sdk-login cannot read /as/resume`
        : `corsSettings.origins is missing ${missing.join(', ')} — the embedded sign-in on /sdk-login fails from there`,
    nextAction: `PingOne console → Applications → ${appLabel} → CORS settings: allow specific origins ` +
      `(corsSettings.behavior ALLOW_SPECIFIC_ORIGINS) and add ${missing.join(', ')} to corsSettings.origins. ` +
      'Nothing provisions this value; it is set by hand.',
    meta: { served, missing },
  };
}

const check = {
  id: 'pingone.pkce_app_cors',
  name: 'PKCE app CORS allows the embedded /sdk-login sign-in',
  category: 'Config / Secrets',
  severity: 'advisory',
  // /sdk-login builds its client from the active provider's discovery document,
  // so the PingOne app's CORS only matters while PingOne is that provider.
  appliesWhen: () => {
    try { return configStore.getOAuthProvider() === 'pingone'; } catch { return false; }
  },
  run: () => runPkceAppCorsCheck(),
};

register(check);
module.exports = { check, runPkceAppCorsCheck };
