// demo_api_server/services/oauthRedirectUris.js
/**
 * Single place for OAuth redirect_uri and frontend origin resolution.
 * PingOne requires redirect_uri to match an allowlisted entry exactly (scheme, host, path).
 *
 * PATTERN: configStore.getEffective() is the single source of truth.
 * On first boot, seed from .env (PUBLIC_APP_URL). After seeding, LMDB wins.
 */
'use strict';

const configStore = require('./configStore');

/**
 * Get canonical public origin for redirect URIs (PUBLIC_APP_URL › REACT_APP_CLIENT_URL › request domain).
 * Handles Vercel deployments (using Vercel environment to override ephemeral domain).
 */
function getCanonicalPublicOrigin(req, opts) {
  if (process.env.PUBLIC_APP_URL) {
    return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.REACT_APP_CLIENT_URL) {
    return process.env.REACT_APP_CLIENT_URL.replace(/\/$/, '');
  }
  if (!req) return 'https://api.ping.demo:4000';

  const forwarded = req.get ? req.get('x-forwarded-host') : req.headers?.['x-forwarded-host'];
  const host = forwarded || (req.get ? req.get('host') : req.headers?.host) || null;

  if (!host) return 'https://api.ping.demo:4000';

  const normalized = host.split(',')[0].trim();
  if (!normalized) return 'https://api.ping.demo:4000';

  const forwardedProto = req.get ? req.get('x-forwarded-proto') : req.headers?.['x-forwarded-proto'];
  const protocol = forwardedProto || (normalized.includes('localhost') || normalized.includes('127.0.0.1') ? 'http' : 'https');

  return `${protocol}://${normalized}`;
}

/**
 * Admin OAuth redirect_uri (must match PingOne Web app allowlist).
 * Detects actual request domain if called with req; otherwise reads from configStore.
 */
function getAdminRedirectUri(req, opts) {
  const override = configStore.getEffective('admin_redirect_uri');
  if (override) return override;

  const origin = getCanonicalPublicOrigin(req, opts);
  return `${origin}/api/auth/oauth/callback`;
}

/**
 * End-user OAuth redirect_uri (must match PingOne app allowlist).
 * Detects actual request domain if called with req; otherwise reads from configStore.
 */
function getUserRedirectUri(req, opts) {
  const override = configStore.getEffective('user_redirect_uri');
  if (override) return override;

  const origin = getCanonicalPublicOrigin(req, opts);
  return `${origin}/api/auth/oauth/user/callback`;
}

/**
 * Frontend origin for redirects after login / config (no /api prefix).
 * Reads from configStore; falls back to env vars or hardcoded default.
 */
function getFrontendOrigin() {
  const fromStore = configStore.getEffective('frontend_url');
  if (fromStore) return (fromStore || '').trim().replace(/[\/\r\n]+$/, '');

  const clientUrl = (process.env.REACT_APP_CLIENT_URL || '').trim();
  if (clientUrl) return clientUrl;

  const publicUrl = (process.env.PUBLIC_APP_URL || '').trim();
  if (publicUrl) return publicUrl;

  return 'https://api.ping.demo:4000';
}

/**
 * Returns the expected frontend origin for this deployment.
 * Used to validate Origin/Referer headers on sensitive endpoints.
 */
function getExpectedFrontendOrigin() {
  if (process.env.PUBLIC_APP_URL) {
    return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.REACT_APP_CLIENT_URL) {
    return process.env.REACT_APP_CLIENT_URL.replace(/\/$/, '');
  }
  return 'https://api.ping.demo:4000';
}

/**
 * Validates that a redirect URI is safe (HTTPS, not localhost in prod).
 */
function validateRedirectUriOrigin(redirectUri) {
  try {
    const { hostname, protocol } = new URL(redirectUri);
    const isProd = process.env.NODE_ENV === 'production';

    if (!hostname) {
      return { ok: false, reason: 'Redirect URI must have a valid hostname.' };
    }

    if (isProd) {
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
        return { ok: false, reason: `Redirect URI hostname “${hostname}” is not allowed on this deployment.` };
      }
      if (protocol === 'http:') {
        return { ok: false, reason: 'Redirect URI must use HTTPS on this deployment.' };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Invalid redirect URI format.' };
  }
}

/**
 * JSON for GET /api/auth/oauth/redirect-info — debug output for PingOne config.
 */
function getOAuthRedirectDebugInfo(req) {
  const admin = getAdminRedirectUri(req);
  const user = getUserRedirectUri(req);
  const frontendOrigin = getFrontendOrigin();
  const postLogoutUri = `${frontendOrigin}/logout`;

  return {
    adminRedirectUri: admin,
    userRedirectUri: user,
    postLogoutUri,
    frontendOrigin,
    canonicalOrigin: getCanonicalPublicOrigin(req),
    referenceRedirectSets: REFERENCE_REDIRECT_SETS,
    pingOneRegisterThese: [...new Set([admin, user])],
    environmentId:    configStore.getEffective('pingone_environment_id') || null,
    adminClientId:    configStore.getEffective('admin_client_id')        || null,
    adminSecretSet:   !!(configStore.getEffective('admin_client_secret')),
    adminSecretHint:  (configStore.getEffective('admin_client_secret') || '').slice(0, 4) || null,
    userClientId:     configStore.getEffective('user_client_id')         || null,
    userSecretSet:    !!(configStore.getEffective('user_client_secret')),
    userSecretHint:   (configStore.getEffective('user_client_secret')  || '').slice(0, 4) || null,
    instructions: {
      summary:
        'In PingOne, each OAuth application (Admin app and Customer app) must list its redirect URI exactly — same scheme, host, and path.',
      steps: [
        'PingOne Admin → Applications → select the Admin app → Configuration → Redirect URIs → add the adminRedirectUri above.',
        'PingOne Admin → Applications → select the Customer app → Configuration → Redirect URIs → add the userRedirectUri above.',
        'Both apps → Configuration → Sign Off URLs → add the postLogoutUri above.',
      ],
    },
  };
}

/**
 * Reference examples for redirect URI registration in different environments.
 */
const REFERENCE_REDIRECT_SETS = [
  {
    id: 'api-ping-demo',
    label: 'Local development (default)',
    adminRedirectUri: 'https://api.ping.demo:4000/api/auth/oauth/callback',
    userRedirectUri: 'https://api.ping.demo:4000/api/auth/oauth/user/callback',
  },
  {
    id: 'custom-host',
    label: 'Custom host (example)',
    adminRedirectUri: 'https://api.pingdeme.org/api/auth/oauth/callback',
    userRedirectUri: 'https://api.pingdeme.org/api/auth/oauth/user/callback',
  },
];

module.exports = {
  getAdminRedirectUri,
  getUserRedirectUri,
  getFrontendOrigin,
  getExpectedFrontendOrigin,
  validateRedirectUriOrigin,
  getOAuthRedirectDebugInfo,
  REFERENCE_REDIRECT_SETS,
};
