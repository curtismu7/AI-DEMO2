'use strict';

/**
 * /api/admin/config  — read/write app configuration.
 *
 * GET  /api/admin/config       → masked config (secrets replaced with ••••••••)
 * POST /api/admin/config       → save one or more config keys
 * POST /api/admin/config/test  → validate PingOne reachability via OIDC discovery
 *                                (same gate as POST — not a public PingOne proxy)
 * POST /api/admin/config/reset → wipe stored config (requires admin session)
 *
 * Security model:
 *  • GET is open (returns masked data — no secret exposure).
 *  • POST is open when no config is stored yet (first-run setup).
 *  • POST is restricted to admin OAuth session once config exists (or X-Config-Password on hosted stacks).
 *  • Reset uses the same gate as POST; on hosted stacks prefer ADMIN_CONFIG_PASSWORD for auth.
 */

const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const rateLimit = require('express-rate-limit');
const configStore = require('../services/configStore');
const { FIELD_DEFS } = require('../services/configStore');
const { getOAuthRedirectDebugInfo } = require('../services/oauthRedirectUris');
const { blockInDemoMode } = require('../middleware/demoMode');
const hosting = require('../config/hosting');
const { probeManagementApiAccess } = require('../services/pingoneBootstrapService');
const appEventService = require('../services/appEventService');
const { getConfigurationStatus, getValidationSummary } = require('../services/envValidation');

const rateLimitDisabled = ['1', 'true', 'yes'].includes(
  String(process.env.DISABLE_RATE_LIMIT || '').toLowerCase()
);

// Rate limit for unauthenticated config reads (GET returns masked data only).
// Admins must match session shape used elsewhere (session.user.role / oauthType) — oauthUser.role was wrong and forced admins into the same cap as anonymous users behind NAT.
const configReadLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 400,               // SPA + Config + hot reload; masked GET only
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Too many config requests. Please wait a minute.' },
  skip: (req) =>
    rateLimitDisabled ||
    isAdminSession(req) ||
    req.session?.oauthType === 'admin',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAdminSession(req) {
  return !!(req.session?.user?.role === 'admin' || req.session?.isAdmin);
}

/**
 * Gate: allow request if (a) no config is stored yet, OR (b) caller is admin,
 * OR (c) hosted mode and the correct ADMIN_CONFIG_PASSWORD header is provided,
 * OR (d) hosted mode and ADMIN_CONFIG_PASSWORD is not set (open demo mode).
 * OR (e) local dev (not Replit) — always open.
 */
function requireAdminOrUnconfigured(req, res, next) {
  if (!configStore.isConfigured()) return next(); // first-run: always open
  if (!hosting.isReplit()) return next(); // local dev: always open
  if (isAdminSession(req)) return next();          // OAuth admin session

  // Hosted Replit: sessions may not persist — optional admin password header.
  if (hosting.useConfigPasswordHeader()) {
    const envPassword = process.env.ADMIN_CONFIG_PASSWORD;
    if (!envPassword) return next(); // no password configured → open demo mode
    if (req.headers['x-config-password'] === envPassword) return next();
    return res.status(401).json({
      error:   'unauthorized',
      message: 'Config password required. Set the X-Config-Password header to match the ADMIN_CONFIG_PASSWORD environment variable.',
    });
  }

  return res.status(401).json({
    error:   'unauthorized',
    message: 'Admin session required to update config once the app is configured.',
  });
}

// ---------------------------------------------------------------------------
// GET /api/admin/config
// ---------------------------------------------------------------------------

router.get('/', configReadLimiter, async (_req, res) => {
  try {
    await configStore.ensureInitialized();
    let redirectInfo = null;
    try {
      redirectInfo = getOAuthRedirectDebugInfo(_req);
    } catch (e) {
      redirectInfo = { error: e.message };
    }

    // Get environment validation status
    const configStatus = getConfigurationStatus();
    const validation = getValidationSummary();

    res.json({
      config:       configStore.getMasked(),
      isConfigured: configStore.isConfigured(),
      storageType:  configStore.getStorageType(),
      readOnly:     configStore.isReadOnly(),
      /** Last boot env-id self-heal record (names only — never values). Null when no reconcile. */
      lastEnvReconcile: configStore.lastEnvReconcile || null,
      /** Hosted (Replit with REPLIT_MANAGED_OAUTH): OAuth clients from env — UI may be deployment-managed. */
      deploymentManagedPingOneOAuth: hosting.isDeploymentManagedPingOneOAuth(),
      /** Demo mode: destructive operations are limited — set via DEMO_MODE env var on shared/public deployments. */
      demoMode: !!process.env.DEMO_MODE,
      /** Deployment platform: 'replit' | 'local' -- used by UI to show environment-specific tabs. */
      hostedOn: hosting.isReplit() ? 'replit' : 'local',
      /** Exact redirect URIs to register in PingOne for this deployment (server-computed). */
      redirectInfo,
      /** Environment validation and configuration status */
      environment: {
        valid: validation.valid,
        scenario: validation.scenario,
        errorCount: validation.errorCount,
        warningCount: validation.warningCount,
        missingVars: validation.missingVars,
        recommendations: validation.recommendations,
        ...configStatus
      }
    });
  } catch (err) {
    console.error('[adminConfig] GET error:', err.message);
    res.status(500).json({ error: 'config_read_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/config
// ---------------------------------------------------------------------------

router.post('/', requireAdminOrUnconfigured, async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'invalid_body', message: 'JSON body required.' });
    }

    // Validate: only accept known keys (case-insensitive — UI sends lowercase, FIELD_DEFS keys are UPPER)
    const dataLower = Object.fromEntries(Object.entries(data).map(([k, v]) => [k.toLowerCase(), v]));
    const filtered = {};
    for (const key of Object.keys(FIELD_DEFS)) {
      const val = dataLower[key.toLowerCase()];
      if (val !== undefined) {
        filtered[key] = String(val).trim(); // empty string = "leave unchanged" (setConfig skips empty)
      }
    }

    await configStore.setConfig(filtered);

    // Audit trail: who changed which config keys, when. Log key NAMES only —
    // never values (many are secrets). Persists to the activity NDJSON so a
    // bad/unauthorized config push is attributable after the fact.
    const changedKeys = Object.keys(filtered).filter((k) => filtered[k] !== '');
    if (changedKeys.length > 0) {
      try {
        appEventService.logEvent('config', 'info', 'Admin config updated', {
          // This route authenticates via the admin SESSION (isAdminSession reads
          // req.session.user); req.user is not populated here.
          actor: req.session?.user?.sub || req.session?.user?.id || 'unconfigured-bootstrap',
          keys: changedKeys,
          count: changedKeys.length,
        });
      } catch (_e) { /* audit is best-effort — never block the config write */ }
    }

    res.json({
      ok:           true,
      config:       configStore.getMasked(),
      isConfigured: configStore.isConfigured(),
    });
  } catch (err) {
    console.error('[adminConfig] POST error:', err.message);
    res.status(500).json({ error: 'config_save_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/config/test  — test PingOne connection
// ---------------------------------------------------------------------------

router.post('/test', requireAdminOrUnconfigured, async (req, res) => {
  try {
    await configStore.ensureInitialized();

    // Prefer values sent in the request body (allows testing before saving)
    const envId    = req.body?.pingone_environment_id || configStore.getEffective('pingone_environment_id');
    const region   = req.body?.pingone_region         || configStore.getEffective('pingone_region') || 'com';
    const clientId = req.body?.admin_client_id        || configStore.getEffective('admin_client_id');

    if (!envId || !clientId) {
      return res.status(400).json({
        ok:    false,
        error: 'missing_config',
        message: 'Set at minimum pingone_environment_id and admin_client_id before testing.',
      });
    }

    // Hit the OIDC discovery endpoint — no credentials required
    const discoveryUrl = `https://auth.pingone.${region}/${envId}/as/.well-known/openid-configuration`;
    const response = await axios.get(discoveryUrl, { timeout: 8000 });

    res.json({
      ok:        true,
      issuer:    response.data.issuer,
      endpoints: {
        authorization: response.data.authorization_endpoint,
        token:         response.data.token_endpoint,
        userinfo:      response.data.userinfo_endpoint,
        jwks:          response.data.jwks_uri,
      },
      message: 'PingOne environment reached successfully.',
    });
  } catch (err) {
    const status = err.response?.status;
    const isNotFound = status === 404;
    res.status(200).json({
      ok:      false,
      error:   isNotFound ? 'environment_not_found' : 'connection_failed',
      message: isNotFound
        ? 'Environment ID not found — check pingone_environment_id and region.'
        : `Failed to reach PingOne: ${err.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/config/reset  — wipe all stored config (admin only)
// ---------------------------------------------------------------------------

router.post('/reset', blockInDemoMode('config reset'), requireAdminOrUnconfigured, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    await configStore.resetConfig();
    res.json({ ok: true, message: 'Configuration cleared.' });
  } catch (err) {
    res.status(500).json({ error: 'reset_failed', message: err.message });
  }
});


// ---------------------------------------------------------------------------
// GET /api/admin/config/worker-test — probe PingOne Management API connection
// ---------------------------------------------------------------------------
router.get('/worker-test', configReadLimiter, async (req, res) => {
  try {
    const result = await probeManagementApiAccess();
    if (result.ok) {
      const envId = configStore.getEffective('pingone_environment_id') || '';
      const appName = result.sample?.[0]?.name || 'Connected';
      return res.json({ ok: true, environmentId: envId, appName, applicationCount: result.applicationCount });
    }
    return res.status(200).json({ ok: false, error: result.error, hint: result.hint });
  } catch (err) {
    console.error('[adminConfig] worker-test error:', err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
});


// ---------------------------------------------------------------------------
// POST /api/admin/config/generate-keypair — generate RSA 2048 key pair for
// private_key_jwt authentication. Saves the private key to configStore and
// returns the public key PEM + JWK so the user can register it in PingOne.
// ---------------------------------------------------------------------------
router.post('/generate-keypair', requireAdminOrUnconfigured, async (req, res) => {
  try {
    const { generateKeyPairSync, createPublicKey } = require('crypto');
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Build JWK from public key
    const pubKeyObj = createPublicKey(publicKey);
    const jwk = pubKeyObj.export({ format: 'jwk' });
    jwk.use = 'sig';
    jwk.alg = 'RS256';
    jwk.kid = require('crypto').randomUUID();

    // Persist private key to config store
    configStore.setConfig({ pingone_mgmt_private_key: privateKey });

    res.json({ ok: true, publicKeyPem: publicKey, jwk });
  } catch (err) {
    console.error('[adminConfig] generate-keypair error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/config/recognize-status — PingOne Recognize credential status
// Returns whether credentials are set (never returns the key value itself).
// ---------------------------------------------------------------------------

router.get('/recognize-status', configReadLimiter, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    const apiKey     = configStore.getEffective('RECOGNIZE_API_KEY')     || '';
    const tenantName = configStore.getEffective('RECOGNIZE_TENANT_NAME') || '';
    res.json({
      apiKeySet:      apiKey.length > 0,
      tenantNameSet:  tenantName.length > 0,
      tenantName:     tenantName || null,
    });
  } catch (err) {
    console.error('[adminConfig] recognize-status error:', err.message);
    res.status(500).json({ error: 'recognize_status_error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/scope-vocabulary — Canonical scope registry (Phase 146)
// ---------------------------------------------------------------------------

router.get('/scope-vocabulary', configReadLimiter, async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs').promises;
    const vocabPath = path.join(__dirname, '..', 'SCOPE_VOCABULARY.md');
    const markdown = await fs.readFile(vocabPath, 'utf-8');
    res.json({ success: true, markdown, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[scope-vocabulary]', error.message);
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'SCOPE_VOCABULARY.md not found' });
    }
    res.status(500).json({ success: false, error: 'Failed to read scope vocabulary' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/oauth-health — OAuth configuration and status
// ---------------------------------------------------------------------------

router.get('/oauth-health', requireAdminOrUnconfigured, configReadLimiter, async (req, res) => {
  try {
    await configStore.ensureInitialized();

    const adminRedirectUri = configStore.getEffective('admin_redirect_uri');
    const userRedirectUri = configStore.getEffective('user_redirect_uri');

    const response = {
      demo_credentials: {
        admin: {
          username: 'demoAdmin',
          password: process.env.DEMO_ADMIN_PASSWORD || 'PingOne@123',
        },
        user: {
          username: 'demoUser',
          password: process.env.DEMO_USER_PASSWORD || 'PingOne@123',
        },
      },
      server_endpoints: {
        bff: {
          url: configStore.getEffective('frontend_url') || 'https://demo-api-server:3001',
          port: 3001,
        },
        pingone_auth: {
          url: `https://auth.pingone.${configStore.getEffective('pingone_region') || 'com'}`,
          port: 443,
        },
        gateway: {
          url: configStore.getEffective('PINGONE_RESOURCE_PINGGATEWAY_URI') || 'https://api.ping.demo:3036/mcp',
          port: 3036,
        },
      },
      environment: {
        pingone_environment_id: configStore.getEffective('pingone_environment_id'),
        pingone_region: configStore.getEffective('pingone_region') || 'com',
        deployment_mode: process.env.DEPLOYMENT_MODE || 'local',
        active_vertical: configStore.getEffective('active_vertical') || 'banking',
      },
      config_sources: {
        admin_redirect_uri: {
          lmdb: configStore.get('admin_redirect_uri') || null,
          env: process.env.PINGONE_ADMIN_REDIRECT_URI || null,
          active: adminRedirectUri,
        },
        user_redirect_uri: {
          lmdb: configStore.get('user_redirect_uri') || null,
          env: process.env.PINGONE_USER_REDIRECT_URI || null,
          active: userRedirectUri,
        },
      },
      recent_errors: [],
    };

    res.json(response);
  } catch (error) {
    console.error('[oauth-health]', error.message);
    res.status(500).json({
      error: 'oauth_health_failed',
      message: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/oauth-health/check — Run OAuth health checks
// ---------------------------------------------------------------------------

router.post('/oauth-health/check', requireAdminOrUnconfigured, configReadLimiter, async (req, res) => {
  const checks = [];

  try {
    const envId = configStore.getEffective('pingone_environment_id');
    const region = configStore.getEffective('pingone_region') || 'com';

    if (!envId) {
      return res.status(400).json({
        error: 'no_environment_id',
        message: 'PingOne environment ID not configured',
      });
    }

    const authBase = `https://auth.pingone.${region}`;
    const jwksUri = `${authBase}/${envId}/as/jwks`;

    // Fetch JWKS once for both checks
    let jwksResponse = null;
    let jwksError = null;
    try {
      jwksResponse = await axios.get(jwksUri, { timeout: 5000 });
    } catch (error) {
      jwksError = error;
    }

    // Check 1: PingOne reachable
    if (jwksError) {
      checks.push({
        name: 'PingOne Reachable',
        status: 'fail',
        detail: jwksError.message || 'Failed to reach PingOne',
      });
    } else {
      checks.push({
        name: 'PingOne Reachable',
        status: 'pass',
        detail: 'Successfully reached PingOne JWKS endpoint',
      });
    }

    // Check 2: JWKS Valid (can parse)
    if (jwksError) {
      checks.push({
        name: 'JWKS Valid',
        status: 'fail',
        detail: jwksError.message || 'Failed to validate JWKS',
      });
    } else if (jwksResponse.data && jwksResponse.data.keys && Array.isArray(jwksResponse.data.keys)) {
      checks.push({
        name: 'JWKS Valid',
        status: 'pass',
        detail: `${jwksResponse.data.keys.length} keys available`,
      });
    } else {
      checks.push({
        name: 'JWKS Valid',
        status: 'fail',
        detail: 'JWKS response missing keys array',
      });
    }

    // Check 3: Redirect URIs configured
    const adminUri = configStore.getEffective('admin_redirect_uri');
    const userUri = configStore.getEffective('user_redirect_uri');

    if (adminUri && userUri) {
      checks.push({
        name: 'Redirect URIs Configured',
        status: 'pass',
        detail: 'Both admin and user redirect URIs set',
      });
    } else {
      checks.push({
        name: 'Redirect URIs Configured',
        status: 'fail',
        detail: `Missing: ${!adminUri ? 'admin ' : ''}${!userUri ? 'user' : ''}`,
      });
    }

    res.json({
      checks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[oauth-health-check]', error.message);
    res.status(500).json({
      error: 'health_check_failed',
      message: error.message,
      checks,
    });
  }
});

module.exports = router;
// Shared with configCredentials.js so both config-write surfaces enforce the
// same first-run-open / admin-once-configured gate.
module.exports.requireAdminOrUnconfigured = requireAdminOrUnconfigured;
