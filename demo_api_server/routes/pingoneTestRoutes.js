/**
 * @file pingoneTestRoutes.js
 * @description Routes for PingOne test page - comprehensive testing of PingOne integration
 *
 * Canonical scope vocabulary: see SCOPE_VOCABULARY.md
 * - read, write — canonical application scopes
 * - accounts:read, transactions:read/write — compound (PingOne resource-level, deprecated)
 * - Token exchange endpoints use MCP_TOKEN_EXCHANGE_SCOPES env var; fallback is compound scopes
 *   until PingOne resource servers are migrated to canonical names.
 */

const express = require('express');
const router = express.Router();
const oauthService = require('../services/oauthService');
const configStore = require('../services/configStore');
const { managementService } = require('../services/pingoneManagementService');
const pingOneUserService = require('../services/pingOneUserService');
const apiCallTrackerService = require('../services/apiCallTrackerService');
const sseHub = require('../services/pingoneTestSseHub');
const scopeTopology = require('../services/scopeTopology');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

/**
 * Expected PingOne configuration sourced from scope-topology.json (the provisioning
 * SoT) via the scopeTopology service — the SAME source the real provisioner uses.
 * Centralised so every test-page handler verifies AND provisions the COMPLETE
 * expected configuration (full scope grants, real app/resource names) rather than a
 * hand-picked subset, and stays correct automatically as verticals add scopes.
 */
function _sotExpectations() {
  const appNames = (scopeTopology._manifest().provisioning || {}).appNames || {};
  const realAppName = (logical) => appNames[logical] || logical;
  // real PingOne app name -> FULL expected granted scopes (apps[].grantedScopes)
  const requiredScopesPerApp = {};
  for (const logical of scopeTopology.allApps()) {
    const scopes = scopeTopology.appGrantedScopes(logical);
    if (scopes.length) requiredScopesPerApp[realAppName(logical)] = scopes;
  }
  return {
    realAppName,
    // core demo apps whose presence the page asserts (real names)
    coreAppNames: [
      'Super Banking User App',
      'Super Banking Admin App',
      'Super Banking MCP Exchanger',
      'Super Banking AI Agent',
    ].map(realAppName),
    // full scope set each resource server must own (native + mirrored, T-10)
    bankingScopes: scopeTopology.resourceScopes('Super Banking API'),
    mcpScopes: scopeTopology.resourceScopes('Super Banking MCP Server'),
    requiredScopesPerApp,
  };
}

/**
 * Decode a JWT for display in the UI — server-side only, never exposes raw token to browser.
 * Returns { header: object, payload: object } matching DecodedTokenPanel's expected shape.
 * Returns null on any error (invalid token, bad base64, etc.).
 *
 * @param {string} token - Raw JWT string
 * @returns {{ header: object, payload: object } | null}
 */
function decodeJwtForDisplay(token) {
  if (!token || typeof token !== 'string') { return null; }
  try {
    const parts = token.split('.');
    if (parts.length !== 3) { return null; }
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { header, payload };
  } catch (_e) {
    return null;
  }
}

/**
 * Helper function to track API calls
 * @param {string} sessionId - Session ID for tracking
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {number} startTime - Start time for duration calculation
 * @param {object} responseData - Response data to track
 * @param {string} category - Category for the API call
 * @param {string} description - Description of the API call
 */
function trackApiCall(sessionId, req, res, startTime, responseData, category, description) {
  const duration = Date.now() - startTime;
  apiCallTrackerService.trackApiCall({
    sessionId,
    method: req.method,
    url: req.originalUrl,
    requestHeaders: req.headers,
    requestBody: req.body,
    responseStatus: res.statusCode || (responseData.success ? 200 : 500),
    responseHeaders: res.getHeaders(),
    responseBody: responseData,
    duration,
    category,
    description
  });
}

/**
 * Build a token event for the UI Token Chain panel from a decoded JWT display object.
 * Mirrors the shape produced by agentMcpTokenService.buildTokenEvent.
 */
function buildExchangeTokenEvent(id, label, status, decoded, explanation) {
  const claims = decoded?.payload || decoded?.claims || null;
  const header = decoded?.header || null;
  const jwtFullDecode = claims != null ? { header, claims } : null;
  return {
    id,
    label,
    status,
    timestamp: new Date().toISOString(),
    alg: header?.alg || null,
    claims,
    explanation,
    ...(jwtFullDecode ? { jwtFullDecode } : {}),
  };
}


/**
 * Build a pingoneRequest debug object for display in the UI.
 * Never includes client_secret or bearer tokens.
 */
function _p1ReqDebug(method, url, contentType, body) {
  return { method, url, contentType: contentType || null, body: body || null };
}

/**
 * GET /api/pingone-test/events
 * SSE stream — pushes token, exchange, and api_call events to the test page in real time.
 * Auth is checked via session (no extra token needed — same session as the test page).
 */
router.get('/events', (req, res) => {
  sseHub.attach(req, res);
});

/**
 * POST /api/pingone-test/worker-config
 * Save worker token configuration to .env and Vercel variables
 */
router.post('/worker-config', async (req, res) => {
  try {
    const { clientId, clientSecret, authMethod, tokenExchangeAuthMethod } = req.body;

    if (!clientId || !clientSecret) {
      return res.json({
        success: false,
        error: 'Client ID and Client Secret are required'
      });
    }

    const storageMethod = 'Local .env file';

    // Update configStore with the new values (persisted to SQLite)
    await configStore.setConfig({
      pingone_worker_token_client_id: clientId,
      pingone_worker_token_client_secret: clientSecret,
      pingone_worker_token_auth_method: authMethod || 'basic',
      pingone_token_exchange_auth_method: tokenExchangeAuthMethod || 'post'
    });

    let updateDetails = {};

    {
      // Local development: update .env file
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '..', '.env');

      try {
        let envContent = '';
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, 'utf8');
        }

        // Update or add the environment variables
        const lines = envContent.split('\n');
        let updatedLines = [];
        let foundClientId = false;
        let foundClientSecret = false;
        let foundAuthMethod = false;
        let foundExchangeAuthMethod = false;

        for (let line of lines) {
          if (line.startsWith('PINGONE_WORKER_TOKEN_CLIENT_ID=')) {
            updatedLines.push(`PINGONE_WORKER_TOKEN_CLIENT_ID=${clientId}`);
            foundClientId = true;
          } else if (line.startsWith('PINGONE_WORKER_TOKEN_CLIENT_SECRET=')) {
            updatedLines.push(`PINGONE_WORKER_TOKEN_CLIENT_SECRET=${clientSecret}`);
            foundClientSecret = true;
          } else if (line.startsWith('PINGONE_WORKER_TOKEN_AUTH_METHOD=')) {
            updatedLines.push(`PINGONE_WORKER_TOKEN_AUTH_METHOD=${authMethod || 'basic'}`);
            foundAuthMethod = true;
          } else if (line.startsWith('PINGONE_TOKEN_EXCHANGE_AUTH_METHOD=')) {
            updatedLines.push(`PINGONE_TOKEN_EXCHANGE_AUTH_METHOD=${tokenExchangeAuthMethod || 'post'}`);
            foundExchangeAuthMethod = true;
          } else if (line.startsWith('PINGONE_MGMT_CLIENT_ID=') || line.startsWith('PINGONE_MGMT_CLIENT_SECRET=') || line.startsWith('PINGONE_MGMT_TOKEN_AUTH_METHOD=')) {
            // Skip old MGMT variables - we're migrating to WORKER_TOKEN
          } else {
            updatedLines.push(line);
          }
        }

        // Add missing variables
        if (!foundClientId) {
          updatedLines.push(`PINGONE_WORKER_TOKEN_CLIENT_ID=${clientId}`);
        }
        if (!foundClientSecret) {
          updatedLines.push(`PINGONE_WORKER_TOKEN_CLIENT_SECRET=${clientSecret}`);
        }
        if (!foundAuthMethod) {
          updatedLines.push(`PINGONE_WORKER_TOKEN_AUTH_METHOD=${authMethod || 'basic'}`);
        }
        if (!foundExchangeAuthMethod) {
          updatedLines.push(`PINGONE_TOKEN_EXCHANGE_AUTH_METHOD=${tokenExchangeAuthMethod || 'post'}`);
        }

        fs.writeFileSync(envPath, updatedLines.join('\n'));
        updateDetails = {
          method: 'Local .env file + SQLite',
          message: 'Configuration saved to .env file and persisted to SQLite. Changes take effect immediately.',
          requiresRestart: false
        };
      } catch (fsError) {
        console.error('[PingOneTest] Failed to update .env file:', fsError.message);
        updateDetails = {
          method: 'SQLite only',
        message: 'Configuration saved to SQLite only. Failed to update .env file: ' + fsError.message,
          requiresRestart: false
        };
      }
    }

    console.log('[PingOneTest] Worker configuration updated:', {
      storageMethod,
      clientId: clientId ? clientId.substring(0, 8) + '...' : 'undefined',
      authMethod
    });

    res.json({
      success: true,
      message: 'Worker configuration saved successfully',
      details: updateDetails
    });
  } catch (error) {
    console.error('[PingOneTest] Worker config save error:', error.message);
    res.json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pingone-test/verify-assets
 * Verify PingOne assets (Apps, Resources, Scopes, Users) using worker token
 */
router.get('/verify-assets', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';
  const requestHeaders = req.headers;

  try {
    await configStore.ensureInitialized();

    console.log('[verify-assets] Starting asset verification');

    // Get worker token using existing oauthService infrastructure
    let workerToken;
    try {
      console.log('[verify-assets] Fetching worker token...');
      workerToken = await oauthService.getAgentClientCredentialsToken();
      console.log('[verify-assets] Worker token obtained successfully');
    } catch (tokenError) {
      console.error('[verify-assets] Failed to obtain worker token:', tokenError.message);
      console.error('[verify-assets] Token error details:', tokenError);
      return res.json({
        success: false,
        error: 'Failed to obtain worker token: ' + tokenError.message,
        assets: null
      });
    }

    // Initialize management service with the worker token
    try {
      console.log('[verify-assets] Initializing management service...');
      managementService.initialize(workerToken);
      console.log('[verify-assets] Management service initialized');
    } catch (initError) {
      console.error('[verify-assets] Management API not configured:', initError.message);
      return res.json({
        success: false,
        error: 'Management API not configured: ' + initError.message,
        assets: null
      });
    }

    // Initialize pingOneUserService with worker credentials
    try {
      console.log('[verify-assets] Initializing pingOneUserService...');
      pingOneUserService.initialize();
      console.log('[verify-assets] pingOneUserService initialized');
    } catch (initError) {
      console.error('[verify-assets] pingOneUserService initialization failed:', initError.message);
      return res.json({
        success: false,
        error: 'pingOneUserService initialization failed: ' + initError.message,
        assets: null
      });
    }

    // Expected assets for missing-item analysis — sourced from scope-topology.json
    // (the provisioning SoT). This verifies the COMPLETE expected configuration:
    // the full scope grant for every modelled app and the full scope set the banking
    // resource server must own — not a hand-picked subset.
    const _sot = _sotExpectations();
    const EXPECTED_APP_NAMES = _sot.coreAppNames;
    const EXPECTED_BANKING_SCOPES = _sot.bankingScopes;

    // Get all assets in parallel (including token policies for SPEL education)
    const [appsResult, resourcesResult, usersResult, tokenPoliciesResult] = await Promise.all([
      managementService.getApplications(),
      managementService.getResourceServers(),
      pingOneUserService.listUsers({ limit: 50 }),
      managementService.getTokenPolicies().catch(() => ({ success: false, tokenPolicies: [] }))
    ]);

    // Enrich each app with its granted resources and grants (parallel)
    const apps = appsResult.success ? (appsResult.applications || []) : [];
    const [appResourceResults, appGrantResults] = await Promise.all([
      Promise.all(
        apps.map(app => managementService.getApplicationResources(app.id)
          .then(r => ({ appId: app.id, resources: r.success ? r.resources : [] }))
          .catch(() => ({ appId: app.id, resources: [] }))
        )
      ),
      Promise.all(
        apps.map(app => managementService.getApplicationGrants(app.id)
          .then(r => ({ appId: app.id, grants: r.success ? r.grants : [] }))
          .catch(() => ({ appId: app.id, grants: [] }))
        )
      )
    ]);
    const appResourcesMap = {};
    appResourceResults.forEach(r => { appResourcesMap[r.appId] = r.resources; });
    const appGrantsMap = {};
    appGrantResults.forEach(r => { appGrantsMap[r.appId] = r.grants; });

    // Get scopes for the BANKING resource server (identified by name/audience — not array index)
    const CANONICAL_BANKING_SCOPES = EXPECTED_BANKING_SCOPES;
    let scopesAsset = { status: 'failed', count: 0, error: 'No resource servers available', data: [], isBankingRS: false, resourceServerName: null };
    let missingCanonicalScopes = [...CANONICAL_BANKING_SCOPES];
    if (resourcesResult.success && resourcesResult.resourceServers && resourcesResult.resourceServers.length > 0) {
      const audienceEnduser = configStore.getEffective('pingone_audience_enduser') || process.env.ENDUSER_AUDIENCE || '';
      const bankingRS = resourcesResult.resourceServers.find(rs => {
        const nameLower = (rs.name || '').toLowerCase();
        const audience = rs.audience || (rs.accessControl && rs.accessControl.audience) || '';
        return nameLower.includes('banking') ||
          (audienceEnduser && audience === audienceEnduser) ||
          nameLower.includes('super bank');
      }) || resourcesResult.resourceServers[0]; // fallback to first if none found
      const isBankingRS = !!(bankingRS && (
        (bankingRS.name || '').toLowerCase().includes('banking') ||
        (bankingRS.name || '').toLowerCase().includes('super bank')
      ));
      const resourceServerId = bankingRS.id;
      const scopesResult = await managementService.getScopes(resourceServerId);
      const scopeNames = (scopesResult.scopes || []).map(s => s.name || s.value || s);
      missingCanonicalScopes = CANONICAL_BANKING_SCOPES.filter(s => !scopeNames.includes(s));

      // Build id→name map across ALL resource servers so grant scope IDs resolve correctly
      // (PingOne /grants returns scope entries as {id} only — no name)
      const scopeIdToName = {};
      const allRSIds = (resourcesResult.resourceServers || []).map(rs => rs.id).filter(Boolean);
      const allScopeResults = await Promise.all(
        allRSIds.map(rsId => managementService.getScopes(rsId).catch(() => ({ scopes: [] })))
      );
      allScopeResults.forEach(r => {
        (r.scopes || []).forEach(s => {
          if (s.id && (s.name || s.value)) scopeIdToName[s.id] = s.name || s.value;
        });
      });
      // Post-process all apps' grants: replace scope IDs with resolved names where possible
      for (const appId of Object.keys(appGrantsMap)) {
        appGrantsMap[appId] = appGrantsMap[appId].map(grant => ({
          ...grant,
          scopes: grant.scopes.map(s => scopeIdToName[s] || s)
        }));
      }
      scopesAsset = {
        status: scopesResult.success ? 'passed' : 'failed',
        count: scopesResult.scopes ? scopesResult.scopes.length : 0,
        error: scopesResult.error,
        data: scopesResult.scopes || [],
        resourceServerId,
        isBankingRS,
        resourceServerName: bankingRS.name || null
      };
    }

    // Compute missing analysis
    const missingApps = EXPECTED_APP_NAMES.filter(
      name => !apps.some(a => a.name === name)
    );
    const missingResourcesByApp = {};
    const missingScopesByApp = {};
    // Per-app required scopes = the FULL grant scope-topology.json models for each
    // app (apps[].grantedScopes), keyed by real PingOne name. Verifying the complete
    // set — not a subset — surfaces any single missing scope as drift.
    const REQUIRED_SCOPES_PER_APP = _sot.requiredScopesPerApp;
    // Check every SoT-modelled app that is present in the environment.
    apps.filter(app => REQUIRED_SCOPES_PER_APP[app.name]).forEach(app => {
      const grantedResources = appGrantsMap[app.id] || appResourcesMap[app.id] || [];
      const allGrantedScopes = grantedResources.flatMap(r => r.scopes || []);
      const requiredForApp = REQUIRED_SCOPES_PER_APP[app.name];
      const missingScopes = requiredForApp.filter(s => !allGrantedScopes.includes(s));
      if (missingScopes.length > 0) {
        missingScopesByApp[app.id] = missingScopes;
      }
    });

    const assets = {
      applications: {
        status: appsResult.success ? 'passed' : 'failed',
        count: apps.length,
        error: appsResult.error,
        data: apps.map(app => ({
          id: app.id,
          name: app.name,
          type: app.type,
          grantedResources: appGrantsMap[app.id] || appResourcesMap[app.id] || [],
          grants: appGrantsMap[app.id] || []
        }))
      },
      resources: {
        status: resourcesResult.success ? 'passed' : 'failed',
        count: resourcesResult.resourceServers ? resourcesResult.resourceServers.length : 0,
        error: resourcesResult.error,
        data: resourcesResult.resourceServers || []
      },
      scopes: scopesAsset,
      users: {
        status: usersResult._embedded && usersResult._embedded.users ? 'passed' : 'failed',
        count: usersResult._embedded && usersResult._embedded.users ? usersResult._embedded.users.length : 0,
        error: usersResult.error,
        data: usersResult._embedded ? usersResult._embedded.users || [] : []
      },
      tokenPolicies: {
        status: tokenPoliciesResult.success
          ? 'passed'
          : tokenPoliciesResult.status === 403
            ? 'insufficient_scope'
            : 'not_available',
        count: tokenPoliciesResult.tokenPolicies ? tokenPoliciesResult.tokenPolicies.length : 0,
        data: tokenPoliciesResult.tokenPolicies || [],
        error: tokenPoliciesResult.error,
        httpStatus: tokenPoliciesResult.status,
      },
      missing: {
        apps: missingApps,
        resourcesByApp: missingResourcesByApp,
        scopesByApp: missingScopesByApp
      },
      expectedApps: EXPECTED_APP_NAMES,
      expectedScopes: EXPECTED_BANKING_SCOPES,
      missingCanonicalScopes
    };
    const responseData = {
      success: true,
      assets
    };

    trackApiCall(sessionId, req, res, startTime, responseData, 'pingone-test', 'Verify PingOne assets (Apps, Resources, Scopes, Users)');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Asset verification error:', error.message);
    const responseData = {
      success: false,
      error: error.message,
      assets: null
    };

    trackApiCall(sessionId, req, res, startTime, responseData, 'pingone-test', 'Verify PingOne assets (Apps, Resources, Scopes, Users)');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/authz-token
 * Test getting Authorization Code token from user session
 */
router.get('/authz-token', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    const oauthTokens = req.session.oauthTokens;
    if (!oauthTokens || !oauthTokens.accessToken) {
      const responseData = {
        success: false,
        error: 'No authorization token found in session. User must log in first.'
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'token-acquisition', 'Get Authorization Code token from user session');
      return res.json(responseData);
    }

    // Verify the token is still valid
    const now = Date.now();
    if (oauthTokens.expiresAt && now > oauthTokens.expiresAt) {
      const responseData = {
        success: false,
        error: 'Authorization token has expired.'
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'token-acquisition', 'Get Authorization Code token from user session');
      return res.json(responseData);
    }

    const decoded = oauthTokens.accessToken ? decodeJwtForDisplay(oauthTokens.accessToken) : null;

    // Derive login type from token scopes + session clientType for UI labelling
    const sessionClientType = req.session.clientType || null;
    const scopes = (decoded?.payload?.scope || '').split(' ');
    let loginType;
    if (scopes.some(s => s === 'admin' || s.startsWith('admin:'))) {
      loginType = 'admin';
    } else if (sessionClientType === 'ai_agent' || scopes.includes('ai_agent') || scopes.includes('ai:agent:read')) {
      loginType = 'ai_agent';
    } else {
      loginType = 'customer';
    }

    const responseData = {
      success: true,
      token: oauthTokens.accessToken ? oauthTokens.accessToken.substring(0, 20) + '...' : 'undefined',
      decoded,
      expiresAt: oauthTokens.expiresAt,
      loginType,
    };
    sseHub.publishToken(req.sessionID || sessionId, { id: 'authz-token', label: 'User Access Token', status: 'success', decoded, expiresAt: oauthTokens.expiresAt });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-acquisition', 'Get Authorization Code token from user session');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Authz token test error:', error.message);
    const responseData = {
      success: false,
      error: error.message
    };
    sseHub.publishToken(req.sessionID || sessionId, { id: 'authz-token', label: 'User Access Token', status: 'error', error: error.message });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-acquisition', 'Get Authorization Code token from user session');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/agent-token
 * Test getting Agent token (client credentials)
 */
router.get('/agent-token', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    await configStore.ensureInitialized();

    const tokenData = await oauthService.getAgentClientCredentialsTokenWithExpiry();
    const _tokenEndpoint = oauthService.config?.tokenEndpoint;
    const _clientId = oauthService.config?.clientId;

    const responseData = {
      success: true,
      token: tokenData.token ? tokenData.token.substring(0, 20) + '...' : 'undefined',
      decoded: tokenData.token ? decodeJwtForDisplay(tokenData.token) : null,
      expires_in: tokenData.expiresIn,
      pingoneRequest: _tokenEndpoint ? _p1ReqDebug('POST', _tokenEndpoint, 'application/x-www-form-urlencoded', {
        grant_type: 'client_credentials',
        client_id: _clientId,
      }) : undefined,
      pingoneResponse: tokenData.token ? {
        token_type: 'Bearer',
        expires_in: tokenData.expiresIn,
        access_token: tokenData.token.substring(0, 20) + '...(truncated)',
        scope: tokenData.token ? decodeJwtForDisplay(tokenData.token)?.payload?.scope : undefined,
      } : undefined,
    };
    sseHub.publishToken(req.sessionID || sessionId, { id: 'agent-token', label: 'Agent CC Token', status: 'success', decoded: responseData.decoded });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-acquisition', 'Get Agent token (client credentials)');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Agent token test error:', error.message);
    const responseData = {
      success: false,
      error: error.message
    };
    sseHub.publishToken(req.sessionID || sessionId, { id: 'agent-token', label: 'Agent CC Token', status: 'error', error: error.message });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-acquisition', 'Get Agent token (client credentials)');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/exchange-user-to-mcp
 * Test exchange user token (authz) for MCP token
 */
router.get('/exchange-user-to-mcp', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    const oauthTokens = req.session.oauthTokens;
    if (!oauthTokens || !oauthTokens.accessToken) {
      const responseData = {
        success: false,
        error: 'No authorization token found in session. User must log in first.'
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user token (authz) for MCP token');
      return res.json(responseData);
    }

    await configStore.ensureInitialized();

    const mcpScopes1 = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write mcp:invoke').trim().split(/\s+/);
    const subjectDecoded1 = decodeJwtForDisplay(oauthTokens.accessToken);
    console.log('[PingOneTest] Exchange1 subject scope:', subjectDecoded1?.payload?.scope);
    console.log('[PingOneTest] Exchange1 requesting mcp scopes:', mcpScopes1.join(' '));

    // Use MCP Token Exchanger credentials to authenticate the exchange.
    // The BFF admin client doesn't have MCP resource server scopes granted in PingOne;
    // only the MCP Token Exchanger app does.
    const mcpExchangerClientId1 = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
    const mcpExchangerSecret1   = configStore.getEffective('pingone_mcp_token_exchanger_client_secret') || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET;
    const mcpExchangerAuthMethod1 = (configStore.getEffective('pingone_token_exchange_auth_method') || process.env.PINGONE_TOKEN_EXCHANGE_AUTH_METHOD || 'post').toLowerCase();
    const mcpAudience1 = configStore.getEffective('pingone_resource_mcp_server_uri') || process.env.PINGONE_RESOURCE_MCP_SERVER_URI;

    const exchangedToken = (mcpExchangerClientId1 && mcpExchangerSecret1)
      ? await oauthService.performTokenExchangeAs(
          oauthTokens.accessToken, null, mcpExchangerClientId1, mcpExchangerSecret1,
          mcpAudience1, mcpScopes1, mcpExchangerAuthMethod1
        )
      : await oauthService.performTokenExchange(
          oauthTokens.accessToken, mcpAudience1, mcpScopes1
        );

    const mcpDecoded1 = exchangedToken ? decodeJwtForDisplay(exchangedToken) : null;
    const tokenEvents1 = [
      buildExchangeTokenEvent('user-token', 'User access token', 'active', subjectDecoded1, 'Authorization Code token from user login (subject token for exchange)'),
      buildExchangeTokenEvent('mcp-token', 'MCP access token', exchangedToken ? 'active' : 'failed', mcpDecoded1, 'RFC 8693 exchanged token — narrowly scoped to MCP server audience'),
    ];
    const _tokenEp = oauthService.config?.tokenEndpoint;
    const _exchangerCid = mcpExchangerClientId1 || oauthService.config?.clientId;
    const responseData = {
      success: true,
      token: exchangedToken ? exchangedToken.substring(0, 20) + '...' : 'undefined',
      decoded: mcpDecoded1,
      subjectTokenDecoded: subjectDecoded1,
      requestedScopes: mcpScopes1,
      tokenEvents: tokenEvents1,
      pingoneRequest: _tokenEp ? _p1ReqDebug('POST', _tokenEp, 'application/x-www-form-urlencoded', {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: mcpAudience1,
        scope: mcpScopes1.join(' '),
        client_id: _exchangerCid,
      }) : undefined,
      pingoneResponse: mcpDecoded1 ? { token_type: 'Bearer', scope: mcpDecoded1.payload?.scope } : undefined,
    };
    sseHub.publishExchange(req.sessionID || sessionId, { id: 'exchange-user-to-mcp', label: 'User → MCP Token', status: 'success', decoded: mcpDecoded1, subjectDecoded: subjectDecoded1 });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user token (authz) for MCP token');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Exchange user to MCP error:', error.message);
    const responseData = {
      success: false,
      error: error.message
    };
    sseHub.publishExchange(req.sessionID || sessionId, { id: 'exchange-user-to-mcp', label: 'User → MCP Token', status: 'error', error: error.message });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user token (authz) for MCP token');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/exchange-id-token-to-mcp
 * FF-gated: requires ff_id_token_exchange === true.
 * Exchanges the session ID token for a scoped MCP access token via RFC 8693
 * (subject_token_type: id_token). Agent never touches the user's access token.
 */
router.get('/exchange-id-token-to-mcp', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  const ffOn = configStore.getEffective('ff_id_token_exchange') === true ||
               configStore.getEffective('ff_id_token_exchange') === 'true';
  if (!ffOn) {
    return res.status(400).json({
      success: false,
      error: 'ff_id_token_exchange is OFF — enable it in Feature Flags to use this exchange pattern.'
    });
  }

  try {
    const oauthTokens = req.session.oauthTokens;
    if (!oauthTokens || !oauthTokens.idToken) {
      return res.json({
        success: false,
        error: 'No ID token found in session. User must log in first.'
      });
    }

    await configStore.ensureInitialized();
    const mcpUri = configStore.getEffective('pingone_resource_mcp_server_uri');
    const mcpScopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write mcp:invoke').trim().split(/\s+/);

    const subjectDecoded = decodeJwtForDisplay(oauthTokens.idToken);
    console.log('[PingOneTest] ID Token exchange subject claims:', subjectDecoded?.payload?.sub, 'scope:', subjectDecoded?.payload?.scope);

    const exchangedToken = await oauthService.performTokenExchangeFromIdToken(
      oauthTokens.idToken,
      mcpUri,
      mcpScopes
    );

    const responseData = {
      success: true,
      token: exchangedToken ? exchangedToken.substring(0, 20) + '...' : 'undefined',
      decoded: exchangedToken ? decodeJwtForDisplay(exchangedToken) : null,
      subjectDecoded,
      requestedScopes: mcpScopes,
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user ID token for MCP token');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] ID Token exchange error:', error.message);
    const responseData = { success: false, error: error.message };
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user ID token for MCP token');
    res.json(responseData);
  }
});


/**
 * GET /api/pingone-test/exchange-idtoken-agent-to-mcp
 * Phase 186: exchange user ID token (subject) + agent CC token (actor)
 * for an MCP Gateway token via a single RFC 8693 call.
 * Like Phase 184 but uses id_token as subject_token_type instead of access_token.
 * FF-gated: requires ff_id_token_exchange === true.
 */
router.get('/exchange-idtoken-agent-to-mcp', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  const ffOn = configStore.getEffective('ff_id_token_exchange') === true ||
               configStore.getEffective('ff_id_token_exchange') === 'true';
  if (!ffOn) {
    return res.status(400).json({
      success: false,
      error: 'ff_id_token_exchange is OFF — enable in Feature Flags to use this exchange pattern.'
    });
  }

  try {
    const oauthTokens = req.session.oauthTokens;
    if (!oauthTokens || !oauthTokens.idToken) {
      const responseData = {
        success: false,
        error: 'No ID token found in session. User must log in first.'
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Phase 186: exchange ID token + agent CC for MCP Gateway token');
      return res.json(responseData);
    }

    await configStore.ensureInitialized();

    // Get actor token using MCP Token Exchanger client
    const agentToken = await oauthService.getMcpExchangerToken();

    const mcpScopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write mcp:invoke').trim().split(/\s+/);

    const subjectDecoded = decodeJwtForDisplay(oauthTokens.idToken);
    const actorDecoded   = decodeJwtForDisplay(agentToken);
    console.log('[PingOneTest] Phase186 ID+Actor subject sub:', subjectDecoded?.payload?.sub);
    console.log('[PingOneTest] Phase186 ID+Actor actor   scope:', actorDecoded?.payload?.scope);

    const mcpExchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.AGENT_OAUTH_CLIENT_ID;
    const mcpExchangerSecret   = configStore.getEffective('pingone_mcp_token_exchanger_client_secret') || process.env.AGENT_OAUTH_CLIENT_SECRET;
    const mcpExchangerAuthMethod = (configStore.getEffective('pingone_token_exchange_auth_method') || process.env.PINGONE_TOKEN_EXCHANGE_AUTH_METHOD || 'post').toLowerCase();
    const gatewayUri = configStore.getEffective('pingone_resource_mcp_gateway_uri');

    // Phase 186: Use ID token as subject + agent CC as actor
    // If we have exchanger credentials, use performTokenExchangeAs with id_token subject type
    // Otherwise fall back to performTokenExchangeWithActorIdToken
    const exchangedToken = await oauthService.performTokenExchangeWithActorIdToken(
      oauthTokens.idToken, agentToken, gatewayUri, mcpScopes
    );

    const mcpDecoded = exchangedToken ? decodeJwtForDisplay(exchangedToken) : null;
    const tokenEvents = [
      buildExchangeTokenEvent('user-id-token', 'User ID token', 'active', subjectDecoded, 'ID token from OIDC login (identity assertion — subject token for exchange)'),
      buildExchangeTokenEvent('actor-token', 'Agent actor token', 'active', actorDecoded, 'Client Credentials token from MCP Token Exchanger (actor in RFC 8693)'),
      buildExchangeTokenEvent('mcp-token', 'MCP access token', exchangedToken ? 'active' : 'failed', mcpDecoded, 'RFC 8693 exchanged token — ID token + actor → MCP gateway token with act claim'),
    ];
    const _tokenEp186 = oauthService.config?.tokenEndpoint;
    const responseData = {
      success: true,
      token: exchangedToken ? exchangedToken.substring(0, 20) + '...' : 'undefined',
      decoded: mcpDecoded,
      subjectTokenDecoded: subjectDecoded,
      actorTokenDecoded: actorDecoded,
      requestedScopes: mcpScopes,
      tokenEvents,
      pingoneRequest: _tokenEp186 ? _p1ReqDebug('POST', _tokenEp186, 'application/x-www-form-urlencoded', {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: gatewayUri,
        scope: mcpScopes.join(' '),
        client_id: mcpExchangerClientId,
      }) : undefined,
      pingoneResponse: mcpDecoded ? { token_type: 'Bearer', scope: mcpDecoded.payload?.scope } : undefined,
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Phase 186: exchange ID token + agent CC for MCP Gateway token');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Phase 186 ID+Actor exchange error:', error.message);
    const responseData = {
      success: false,
      error: error.message
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Phase 186: exchange ID token + agent CC for MCP Gateway token');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/exchange-user-agent-to-mcp
 * Phase 184 canonical path: exchange user token (subject) + agent CC token (actor)
 * for an MCP Gateway token via a single RFC 8693 call.
 */
router.get('/exchange-user-agent-to-mcp', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    const oauthTokens = req.session.oauthTokens;
    if (!oauthTokens || !oauthTokens.accessToken) {
      const responseData = {
        success: false,
        error: 'No authorization token found in session. User must log in first.'
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Phase 184: exchange user token + agent CC token for MCP Gateway token');
      return res.json(responseData);
    }

    await configStore.ensureInitialized();

    // Diagnostic switch (A2): ?actor=aiagent uses the AI Agent (d21c5124) as the actor —
    // the client the user's may_act authorizes — so PingOne emits the `act` claim. Default
    // (Exchanger) is unchanged. ?aud=agentgateway targets the Two-Exchange Step-1 audience
    // (agentgateway.ping.demo, scope agent:invoke); default is the mcp gateway audience.
    const useAiAgent = req.query.actor === 'aiagent';
    const toAgentGateway = req.query.aud === 'agentgateway';

    // Get actor token: AI Agent (may_act actor) when requested, else MCP Token Exchanger.
    const agentToken = useAiAgent
      ? await oauthService.getAiAgentClientCredentialsToken()
      : await oauthService.getMcpExchangerToken();

    // Perform token exchange with both user and agent tokens
    const mcpScopes2 = toAgentGateway
      ? ['agent:invoke']
      : (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write mcp:invoke').trim().split(/\s+/);
    const targetAudience = toAgentGateway
      ? configStore.getEffective('pingone_resource_agent_gateway_uri')
      : configStore.getEffective('pingone_resource_mcp_gateway_uri');

    const subjectDecoded2 = decodeJwtForDisplay(oauthTokens.accessToken);
    const actorDecoded2   = decodeJwtForDisplay(agentToken);
    console.log('[PingOneTest] Exchange2 subject scope:', subjectDecoded2?.payload?.scope);
    console.log('[PingOneTest] Exchange2 actor   scope:', actorDecoded2?.payload?.scope, 'client_id:', actorDecoded2?.payload?.client_id);
    console.log('[PingOneTest] Exchange2 requesting scopes:', mcpScopes2.join(' '), '→ aud:', targetAudience);

    // ALWAYS authenticate the exchange as the MCP Token Exchanger (the designated
    // token-exchange client that can parse the user subject_token). The actor IDENTITY that
    // PingOne's may_act SpEL checks is the actor_token's client_id (above) — not the client
    // authenticating the request. Authenticating AS the AI Agent fails with "Cannot parse
    // token claims for subject_token"; the may_act match comes from actor_token=AI Agent.
    const exchClientId2 = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.AGENT_OAUTH_CLIENT_ID;
    const exchSecret2 = configStore.getEffective('pingone_mcp_token_exchanger_client_secret') || process.env.AGENT_OAUTH_CLIENT_SECRET;
    const mcpExchangerAuthMethod2 = (configStore.getEffective('pingone_token_exchange_auth_method') || process.env.PINGONE_TOKEN_EXCHANGE_AUTH_METHOD || 'post').toLowerCase();
    const exchangedToken = (exchClientId2 && exchSecret2)
      ? await oauthService.performTokenExchangeAs(
          oauthTokens.accessToken, agentToken, exchClientId2, exchSecret2,
          targetAudience, mcpScopes2, mcpExchangerAuthMethod2
        )
      : await oauthService.performTokenExchangeWithActor(
          oauthTokens.accessToken, agentToken,
          targetAudience, mcpScopes2
        );

    const mcpDecoded2 = exchangedToken ? decodeJwtForDisplay(exchangedToken) : null;
    const tokenEvents2 = [
      buildExchangeTokenEvent('user-token', 'User access token', 'active', subjectDecoded2, 'Authorization Code token from user login (subject token for exchange)'),
      buildExchangeTokenEvent('actor-token', 'Agent actor token', 'active', actorDecoded2, 'Client Credentials token from MCP Token Exchanger (actor in RFC 8693)'),
      buildExchangeTokenEvent('mcp-token', 'MCP access token', exchangedToken ? 'active' : 'failed', mcpDecoded2, 'RFC 8693 exchanged token — narrowly scoped to MCP gateway audience'),
    ];
    const responseData = {
      success: true,
      token: exchangedToken ? exchangedToken.substring(0, 20) + '...' : 'undefined',
      decoded: mcpDecoded2,
      subjectTokenDecoded: subjectDecoded2,
      actorTokenDecoded: actorDecoded2,
      requestedScopes: mcpScopes2,
      tokenEvents: tokenEvents2,
    };
    sseHub.publishExchange(req.sessionID || sessionId, { id: 'exchange-user-agent-to-mcp', label: 'User + Agent → MCP Gateway', status: 'success', decoded: mcpDecoded2, subjectDecoded: subjectDecoded2, actorDecoded: actorDecoded2 });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user token (authz) and Agent Token (client creds) for MCP token');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Exchange user+agent to MCP error:', error.message);
    const responseData = {
      success: false,
      error: error.message
    };
    sseHub.publishExchange(req.sessionID || sessionId, { id: 'exchange-user-agent-to-mcp', label: 'User + Agent → MCP Gateway', status: 'error', error: error.message });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user token (authz) and Agent Token (client creds) for MCP token');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/exchange-user-to-agent-to-mcp
 * Legacy educational flow: exchange user token for agent token, then exchange
 * user+agent for MCP Server token (two RFC 8693 calls).
 */
router.get('/exchange-user-to-agent-to-mcp', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    const oauthTokens = req.session.oauthTokens;
    if (!oauthTokens || !oauthTokens.accessToken) {
      const responseData = {
        success: false,
        error: 'No authorization token found in session. User must log in first.'
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user token for Agent Token, then use those 2 for MCP token');
      return res.json(responseData);
    }

    await configStore.ensureInitialized();

    // Step 1: Obtain the AI Agent's token (the actor in the delegation chain). The
    // agent authenticates as ITSELF via client-credentials — agent:invoke is granted
    // to the AI Agent identity and is NOT mintable from a user subject token, so the
    // old user→agent exchange always failed with "At least one scope must be granted".
    const agentToken = await oauthService.getAiAgentClientCredentialsToken();

    // Step 2: Exchange user token (subject) + agent token (actor) for an MCP token.
    // This is the RFC 8693 delegation — the issued MCP token carries act.sub = the AI
    // Agent. Target the MCP gateway audience the delegated token is scoped to.
    const mcpScopes3 = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write mcp:invoke').trim().split(/\s+/);
    const mcpAudience3 = configStore.getEffective('pingone_resource_mcp_gateway_uri')
      || configStore.getEffective('pingone_resource_mcp_server_uri');
    const mcpExchangerClientId3 = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.AGENT_OAUTH_CLIENT_ID;
    const mcpExchangerSecret3   = configStore.getEffective('pingone_mcp_token_exchanger_client_secret') || process.env.AGENT_OAUTH_CLIENT_SECRET;
    const mcpExchangerAuthMethod3 = (configStore.getEffective('pingone_token_exchange_auth_method') || process.env.PINGONE_TOKEN_EXCHANGE_AUTH_METHOD || 'post').toLowerCase();
    const mcpToken = (mcpExchangerClientId3 && mcpExchangerSecret3)
      ? await oauthService.performTokenExchangeAs(
          oauthTokens.accessToken, agentToken, mcpExchangerClientId3, mcpExchangerSecret3,
          mcpAudience3, mcpScopes3, mcpExchangerAuthMethod3
        )
      : await oauthService.performTokenExchangeWithActor(
          oauthTokens.accessToken, agentToken,
          mcpAudience3, mcpScopes3
        );

    const agentDecoded3 = agentToken ? decodeJwtForDisplay(agentToken) : null;
    const mcpDecoded3 = mcpToken ? decodeJwtForDisplay(mcpToken) : null;
    const subjectDecoded3 = oauthTokens?.accessToken ? decodeJwtForDisplay(oauthTokens.accessToken) : null;
    const tokenEvents3 = [
      buildExchangeTokenEvent('user-token', 'User access token', 'active', subjectDecoded3, 'Authorization Code token from user login (subject)'),
      buildExchangeTokenEvent('agent-token', 'Agent token (actor)', 'active', agentDecoded3, 'AI Agent client-credentials token — the actor in the RFC 8693 delegation'),
      buildExchangeTokenEvent('mcp-token', 'MCP access token', mcpToken ? 'active' : 'failed', mcpDecoded3, 'Exchange: user (subject) + agent (actor) → MCP-scoped token carrying act.sub'),
    ];
    const responseData = {
      success: true,
      agentToken: agentToken ? agentToken.substring(0, 20) + '...' : 'undefined',
      mcpToken: mcpToken ? mcpToken.substring(0, 20) + '...' : 'undefined',
      agentTokenDecoded: agentDecoded3,
      mcpTokenDecoded: mcpDecoded3,
      subjectTokenDecoded: subjectDecoded3,
      tokenEvents: tokenEvents3,
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user token for Agent Token, then use those 2 for MCP token');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Exchange user→agent→MCP error:', error.message);
    const responseData = {
      success: false,
      error: error.message
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Exchange user token for Agent Token, then use those 2 for MCP token');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/worker-token
 * Get worker token for PingOne Management API calls
 * Uses client credentials from MCP token exchanger app
 */
router.get('/worker-token', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    await configStore.ensureInitialized();

    const workerTokenData = await oauthService.getAgentClientCredentialsTokenWithExpiry();
    
    const responseData = {
      success: true,
      status: workerTokenData.token ? 'valid' : 'missing',
      decoded: workerTokenData.token ? decodeJwtForDisplay(workerTokenData.token) : null,
      expiresAt: workerTokenData.expiresAt
    };
    sseHub.publishToken(req.sessionID || sessionId, { id: 'worker-token', label: 'Worker Token', status: 'success', decoded: responseData.decoded, expiresAt: responseData.expiresAt });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-acquisition', 'Get worker token for PingOne Management API calls');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Worker token error:', error.message);
    const responseData = {
      success: false,
      error: error.message
    };
    sseHub.publishToken(req.sessionID || sessionId, { id: 'worker-token', label: 'Worker Token', status: 'error', error: error.message });
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-acquisition', 'Get worker token for PingOne Management API calls');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/config
 * Get PingOne configuration from environment
 */
router.get('/config', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    await configStore.ensureInitialized();

    const config = {
      environmentId: configStore.getEffective('pingone_environment_id'),
      region: configStore.getEffective('pingone_region'),
      adminClientId: configStore.getEffective('admin_client_id'),
      userClientId: configStore.getEffective('user_client_id'),
      mcpTokenExchangerClientId: configStore.getEffective('pingone_mcp_token_exchanger_client_id'),
      aiAgentClientId: configStore.getEffective('pingone_ai_agent_client_id'),
      resourceMcpServerUri: configStore.getEffective('pingone_resource_mcp_server_uri'),
      resourceMcpGatewayUri: configStore.getEffective('pingone_resource_mcp_gateway_uri'),
      resourceAgentGatewayUri: configStore.getEffective('pingone_resource_agent_gateway_uri'),
      // Worker token credentials (for pre-populating the form)
      mgmtClientId: process.env.PINGONE_WORKER_TOKEN_CLIENT_ID || configStore.getEffective('pingone_worker_token_client_id') || configStore.getEffective('pingone_mgmt_client_id'),
      mgmtClientSecret: process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET || configStore.getEffective('pingone_worker_token_client_secret') || configStore.getEffective('pingone_mgmt_client_secret'),
      mgmtTokenAuthMethod: process.env.PINGONE_WORKER_TOKEN_AUTH_METHOD || configStore.getEffective('pingone_worker_token_auth_method') || configStore.getEffective('pingone_mgmt_token_auth_method') || 'basic',
      tokenExchangeAuthMethod: process.env.PINGONE_TOKEN_EXCHANGE_AUTH_METHOD || configStore.getEffective('pingone_token_exchange_auth_method') || 'post',
      // Two-exchange delegation (RFC 8693 double-hop)
      twoExchangeResourceUri: process.env.PINGONE_RESOURCE_TWO_EXCHANGE_URI || configStore.getEffective('pingone_resource_two_exchange_uri') || null,
      ffTwoExchangeDelegation: (process.env.FF_TWO_EXCHANGE_DELEGATION === 'true') || (configStore.getEffective('ff_two_exchange_delegation') === 'true') || false,
      ffIdTokenExchange: configStore.getEffective('ff_id_token_exchange') === true || configStore.getEffective('ff_id_token_exchange') === 'true'
    };

    // Partially mask secrets for display (show first 8 chars)
    const maskedConfig = Object.entries(config).reduce((acc, [key, value]) => {
      if (key.includes('Secret') || key.includes('secret')) {
        if (value && typeof value === 'string' && value.length > 8) {
          acc[key] = value.substring(0, 8) + '...';
        } else if (value) {
          acc[key] = '***';
        } else {
          acc[key] = '';
        }
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});

    const responseData = {
      success: true,
      config: maskedConfig
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'config', 'Get PingOne configuration from environment');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Config error:', error.message);
    const responseData = {
      success: false,
      error: error.message
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'config', 'Get PingOne configuration from environment');
    res.status(500).json(responseData);
  }
});

/**
 * POST /api/pingone-test/token-exchange
 * Test token exchange in single or dual mode.
 */
router.post('/token-exchange', async (req, res) => {
  try {
    // Security: require authenticated session — don't accept raw tokens from unauthenticated callers
    if (!req.session?.oauthTokens?.accessToken) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    await configStore.ensureInitialized();
    
    const { mode = 'single', subjectToken, actorToken } = req.body;
    const normalizedMode = mode === 'double' ? 'dual' : mode;
    const mcpServerUri = configStore.getEffective('pingone_resource_mcp_server_uri');
    const mcpGatewayUri = configStore.getEffective('pingone_resource_mcp_gateway_uri') || mcpServerUri;
    const scopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write mcp:invoke').trim().split(/\s+/);
    
    let result;
    if (normalizedMode === 'single') {
      result = await oauthService.performTokenExchange(subjectToken, mcpServerUri, scopes);
    } else if (normalizedMode === 'dual') {
      // Use MCP Token Exchanger credentials for the exchange authentication
      const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.AGENT_OAUTH_CLIENT_ID;
      const exchangerSecret   = configStore.getEffective('pingone_mcp_token_exchanger_client_secret') || process.env.AGENT_OAUTH_CLIENT_SECRET;
      if (exchangerClientId && exchangerSecret) {
        result = await oauthService.performTokenExchangeAs(subjectToken, actorToken, exchangerClientId, exchangerSecret, mcpGatewayUri, scopes);
      } else {
        result = await oauthService.performTokenExchangeWithActor(subjectToken, actorToken, mcpGatewayUri, scopes);
      }
    } else {
      throw new Error('Invalid mode. Use "single", "dual", or "double" (legacy alias).');
    }
    
    // Decode token to show claims
    const parts = result.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    
    res.json({
      success: true,
      mode: normalizedMode,
      token: result,
      claims: payload
    });
  } catch (error) {
    console.error('[PingOneTest] Token exchange error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/pingone-test/apps
 * Test PingOne Applications via Management API
 */
router.get('/apps', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    await configStore.ensureInitialized();

    // Get worker token and initialize management service
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    try {
      managementService.initialize(workerToken);
    } catch (initError) {
      const responseData = {
        success: false,
        error: 'Management API not configured: ' + initError.message,
        apps: []
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Applications via Management API');
      return res.json(responseData);
    }

    const result = await managementService.getApplications();

    const responseData = {
      success: result.success,
      apps: result.applications || [],
      count: result.applications?.length || 0,
      error: result.error,
      pingoneRequest: managementService.baseURL ? _p1ReqDebug('GET', `${managementService.baseURL}/applications`) : undefined,
      pingoneResponse: result.success ? { applications_count: result.applications?.length || 0 } : { error: result.error },
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Applications via Management API');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Apps test error:', error.message);
    const responseData = {
      success: false,
      error: error.message,
      apps: []
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Applications via Management API');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/resources
 * Test PingOne Resource Servers via Management API
 */
router.get('/resources', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    await configStore.ensureInitialized();

    // Get worker token and initialize management service
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    try {
      managementService.initialize(workerToken);
    } catch (initError) {
      const responseData = {
        success: false,
        error: 'Management API not configured: ' + initError.message,
        resources: []
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Resource Servers via Management API');
      return res.json(responseData);
    }

    const result = await managementService.getResourceServers();

    const responseData = {
      success: result.success,
      resources: result.resourceServers || [],
      count: result.resourceServers?.length || 0,
      error: result.error,
      pingoneRequest: managementService.baseURL ? _p1ReqDebug('GET', `${managementService.baseURL}/resourceServers`) : undefined,
      pingoneResponse: result.success ? { resourceServers_count: result.resourceServers?.length || 0 } : { error: result.error },
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Resource Servers via Management API');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Resources test error:', error.message);
    const responseData = {
      success: false,
      error: error.message,
      resources: []
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Resource Servers via Management API');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/scopes
 * Test PingOne Scopes via Management API
 */
router.get('/scopes', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    await configStore.ensureInitialized();

    // Get worker token and initialize management service
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    try {
      managementService.initialize(workerToken);
    } catch (initError) {
      const responseData = {
        success: false,
        error: 'Management API not configured: ' + initError.message,
        scopes: []
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Scopes via Management API');
      return res.json(responseData);
    }

    const { resourceServerId } = req.query;

    if (!resourceServerId) {
      const responseData = {
        success: false,
        error: 'resourceServerId query parameter is required',
        scopes: []
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Scopes via Management API');
      return res.json(responseData);
    }

    const result = await managementService.getScopes(resourceServerId);

    const responseData = {
      success: result.success,
      scopes: result.scopes || [],
      count: result.scopes?.length || 0,
      resourceServerId,
      error: result.error,
      pingoneRequest: managementService.baseURL ? _p1ReqDebug('GET', `${managementService.baseURL}/resourceServers/${resourceServerId}/scopes`) : undefined,
      pingoneResponse: result.success ? { scopes_count: result.scopes?.length || 0 } : { error: result.error },
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Scopes via Management API');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Scopes test error:', error.message);
    const responseData = {
      success: false,
      error: error.message,
      scopes: []
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Scopes via Management API');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/users
 * Test PingOne Users via Management API using worker token
 */
router.get('/users', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';

  try {
    await configStore.ensureInitialized();

    // Initialize user service
    try {
      pingOneUserService.initialize();
      console.log('[PingOneTest] pingOneUserService initialized successfully');
    } catch (initError) {
      console.error('[PingOneTest] pingOneUserService initialization failed:', initError.message);
      const responseData = {
        success: false,
        error: 'User service not configured: ' + initError.message,
        users: []
      };
      trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Users via Management API using worker token');
      return res.json(responseData);
    }

    const result = await pingOneUserService.listUsers({ limit: 50 });
    console.log('[PingOneTest] listUsers result:', JSON.stringify(result, null, 2));

    const users = result._embedded?.users || [];

    const responseData = {
      success: true,
      users,
      count: users.length,
      error: null,
      pingoneRequest: managementService.baseURL ? _p1ReqDebug('GET', `${managementService.baseURL}/users?limit=20`) : undefined,
      pingoneResponse: { users_count: users.length },
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Users via Management API using worker token');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Users test error:', error.message);
    console.error('[PingOneTest] PingOne API error status:', error.response?.status);
    console.error('[PingOneTest] PingOne API error data:', error.response?.data);
    const responseData = {
      success: false,
      error: error.message,
      users: []
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Test PingOne Users via Management API using worker token');
    res.json(responseData);
  }
});;

/**
 * POST /api/pingone-test/fix-banking-resource-server
 * Creates or idempotently updates the banking resource server and canonical scopes.
 */
router.post('/fix-banking-resource-server', async (req, res) => {
  try {
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) {
      return res.status(503).json({ success: false, error: 'Worker token unavailable — check agent client credentials' });
    }
    managementService.initialize(workerToken);

    const CANONICAL_BANKING_SCOPES = _sotExpectations().bankingScopes;
    const audienceEnduser = configStore.getEffective('pingone_audience_enduser') || process.env.ENDUSER_AUDIENCE || 'enduser.ping.demo';

    // Find or create the banking resource server
    const resourcesResult = await managementService.getResourceServers();
    let bankingRS = null;
    if (resourcesResult.success && resourcesResult.resourceServers) {
      bankingRS = resourcesResult.resourceServers.find(rs => {
        const nameLower = (rs.name || '').toLowerCase();
        const audience = rs.audience || (rs.accessControl && rs.accessControl.audience) || '';
        return nameLower.includes('banking') || nameLower.includes('super bank') ||
          (audienceEnduser && audience === audienceEnduser);
      });
    }

    let resourceServerId;
    let created = false;
    if (!bankingRS) {
      const createResult = await managementService.createResourceServer({
        name: 'Demo API',
        audience: audienceEnduser,
        description: 'Banking API resource server for the Demo AI App'
      });
      if (!createResult.success) {
        return res.status(502).json({ success: false, error: `Failed to create resource server: ${createResult.error}` });
      }
      resourceServerId = createResult.resourceServer?.id || createResult.id;
      created = true;
    } else {
      resourceServerId = bankingRS.id;
    }

    // Get existing scopes and add any missing canonical ones
    const existingScopesResult = await managementService.getScopes(resourceServerId);
    const existingNames = (existingScopesResult.scopes || []).map(s => s.name || s.value || s);
    const scopesToCreate = CANONICAL_BANKING_SCOPES.filter(s => !existingNames.includes(s));

    const scopeResults = await Promise.all(
      scopesToCreate.map(scopeName =>
        managementService.createScopes(resourceServerId, [{ name: scopeName, description: `Banking scope: ${scopeName}` }])
          .then(results => ({ scope: scopeName, success: results[0]?.success ?? false, error: results[0]?.error }))
          .catch(e => ({ scope: scopeName, success: false, error: e.message }))
      )
    );

    res.json({
      success: true,
      resourceServerId,
      created,
      scopeResults,
      message: created
        ? `Banking resource server created and ${scopesToCreate.length} scope(s) added`
        : `${scopesToCreate.length} missing scope(s) added to existing banking resource server`
    });
  } catch (error) {
    console.error('[PingOneTest] fix-banking-resource-server error:', error.message);
    res.status(500).json({ success: false, error: 'Operation failed. Check server logs.' });
  }
});

/**
 * GET /api/pingone-test/diagnose-mcp-exchange
 * Diagnoses why token exchange fails: checks MCP RS exists, what scopes it has,
 * and what the MCP Token Exchanger app has assigned.
 */
router.get('/diagnose-mcp-exchange', async (req, res) => {
  try {
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) {
      return res.status(503).json({ success: false, error: 'Worker token unavailable' });
    }
    managementService.initialize(workerToken);

    const mcpUri = configStore.getEffective('pingone_resource_mcp_server_uri') || process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
    const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
    const requestedScopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || '').trim().split(/\s+/).filter(Boolean);

    // 1. Find the MCP resource server — audience match is authoritative;
    //    name fallback requires both "mcp" and "server" and excludes "gateway"
    const rsResult = await managementService.getResourceServers();
    const allRS = rsResult.resourceServers || [];
    const mcpRS = allRS.find(rs => {
      const aud = rs.audience || (rs.accessControl && rs.accessControl.audience) || '';
      if (aud === mcpUri) return true;
      const n = (rs.name || '').toLowerCase();
      return n.includes('mcp') && n.includes('server') && !n.includes('gateway');
    });

    let mcpRSScopes = [];
    if (mcpRS) {
      const scopesResult = await managementService.getScopes(mcpRS.id);
      mcpRSScopes = (scopesResult.scopes || []).map(s => ({ id: s.id, name: s.name || s.value }));
    }

    // 2. Find the exchanger app and its grants
    const appsResult = await managementService.getApplications();
    const allApps = appsResult.applications || [];
    const exchangerApp = allApps.find(a => a.id === exchangerClientId || a.oidcOptions?.clientId === exchangerClientId);

    let exchangerGrants = [];
    let exchangerHasMcpRS = false;
    let exchangerMcpScopes = [];
    if (exchangerApp) {
      const grantsResult = await managementService.getApplicationGrants(exchangerApp.id);
      exchangerGrants = grantsResult.grants || [];
      const mcpGrant = exchangerGrants.find(g => g.resourceId === mcpRS?.id || g.name === (mcpRS?.name));
      exchangerHasMcpRS = !!mcpGrant;
      exchangerMcpScopes = mcpGrant?.scopes || [];
    }

    const missingFromRS = requestedScopes.filter(s => !mcpRSScopes.some(r => r.name === s));

    // exchangerMcpScopes may contain scope IDs (UUIDs) if PingOne didn't return names in the grant.
    // Resolve IDs → names using the RS scope list so comparison against requestedScopes works.
    const resolvedExchangerScopes = exchangerMcpScopes.map(idOrName => {
      const match = mcpRSScopes.find(r => r.id === idOrName || r.name === idOrName);
      return match ? match.name : idOrName;
    });
    const missingFromApp = requestedScopes.filter(s => !resolvedExchangerScopes.includes(s));

    const canExchangeResult = missingFromRS.length === 0 && missingFromApp.length === 0 && exchangerHasMcpRS;

    // --- Claim Validation: Perform a test exchange and validate resulting token claims ---
    let claimValidation = null;
    if (canExchangeResult) {
      try {
        const userToken = req.session?.oauthTokens?.accessToken;
        if (userToken) {
          const mcpExchangerClientId2 = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
          const mcpExchangerSecret2 = configStore.getEffective('pingone_mcp_token_exchanger_client_secret') || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET;
          const mcpExchangerAuthMethod2 = (configStore.getEffective('pingone_token_exchange_auth_method') || process.env.PINGONE_TOKEN_EXCHANGE_AUTH_METHOD || 'post').toLowerCase();

          if (mcpExchangerClientId2 && mcpExchangerSecret2) {
            const exchangeResult = await oauthService.performTokenExchangeAs(
              userToken, null, mcpExchangerClientId2, mcpExchangerSecret2,
              mcpUri, requestedScopes, mcpExchangerAuthMethod2
            );

            if (exchangeResult) {
              const decoded = decodeJwtForDisplay(exchangeResult);
              const issues = [];

              if (decoded?.payload) {
                // Validate audience
                const actualAud = Array.isArray(decoded.payload.aud) ? decoded.payload.aud : [decoded.payload.aud];
                if (!actualAud.includes(mcpUri)) {
                  issues.push({
                    claim: 'aud',
                    expected: mcpUri,
                    actual: decoded.payload.aud,
                    fix: 'MCP Resource Server audience must match PINGONE_RESOURCE_MCP_SERVER_URI'
                  });
                }

                // Validate scopes present
                const actualScopes = (decoded.payload.scope || '').split(' ').filter(Boolean);
                const missingScopes = requestedScopes.filter(s => !actualScopes.includes(s));
                if (missingScopes.length > 0) {
                  issues.push({
                    claim: 'scope',
                    expected: requestedScopes,
                    actual: actualScopes,
                    missing: missingScopes,
                    fix: 'Assign missing scopes to MCP Token Exchanger app grant'
                  });
                }

                // Validate client_id is the exchanger app
                if (decoded.payload.client_id && decoded.payload.client_id !== exchangerClientId) {
                  issues.push({
                    claim: 'client_id',
                    expected: exchangerClientId,
                    actual: decoded.payload.client_id,
                    fix: 'Token client_id should match MCP Token Exchanger app'
                  });
                }

                claimValidation = {
                  tested: true,
                  issues,
                  allClaimsValid: issues.length === 0,
                  decodedSample: {
                    aud: decoded.payload.aud,
                    scope: decoded.payload.scope,
                    client_id: decoded.payload.client_id,
                    act: decoded.payload.act || null,
                    may_act: decoded.payload.may_act || null
                  }
                };
              } else {
                claimValidation = { tested: true, exchangeFailed: true, error: 'Could not decode exchanged token' };
              }
            } else {
              claimValidation = { tested: true, exchangeFailed: true, error: 'Exchange returned no access_token' };
            }
          } else {
            claimValidation = { tested: false, reason: 'MCP Token Exchanger credentials not configured' };
          }
        } else {
          claimValidation = { tested: false, reason: 'No user token in session — log in first to test claims' };
        }
      } catch (claimErr) {
        claimValidation = { tested: false, reason: claimErr.message };
      }
    }

    res.json({
      success: true,
      mcpUri,
      mcpResourceServer: mcpRS ? { id: mcpRS.id, name: mcpRS.name, audience: mcpRS.audience } : null,
      mcpRSScopes,
      exchangerApp: exchangerApp ? { id: exchangerApp.id, name: exchangerApp.name } : null,
      exchangerHasMcpRS,
      exchangerMcpScopes: resolvedExchangerScopes,
      requestedScopes,
      missingFromRS,
      missingFromApp,
      canExchange: canExchangeResult,
      claimValidation,
    });
  } catch (error) {
    console.error('[PingOneTest] diagnose-mcp-exchange error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/pingone-test/fix-mcp-exchange
 * 1. Find/create MCP resource server at PINGONE_RESOURCE_MCP_SERVER_URI
 * 2. Create any missing scopes on it
 * 3. Enable Token Exchange grant on the MCP Token Exchanger app
 * 4. Assign MCP RS + scopes to the MCP Token Exchanger app via /resources
 */
router.post('/fix-mcp-exchange', async (req, res) => {
  try {
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) {
      return res.status(503).json({ success: false, error: 'Worker token unavailable' });
    }
    managementService.initialize(workerToken);

    const mcpUri = configStore.getEffective('pingone_resource_mcp_server_uri') || process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
    const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
    const requestedScopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write mcp:invoke').trim().split(/\s+/).filter(Boolean);

    const steps = [];

    // Step 1: Find or create MCP resource server
    const rsResult = await managementService.getResourceServers();
    const allRS = rsResult.resourceServers || [];
    // Audience match is authoritative; name fallback excludes 'gateway'
    let mcpRS = allRS.find(rs => {
      const aud = rs.audience || (rs.accessControl && rs.accessControl.audience) || '';
      if (aud === mcpUri) return true;
      const n = (rs.name || '').toLowerCase();
      return n.includes('mcp') && n.includes('server') && !n.includes('gateway');
    });

    let mcpRSCreated = false;
    if (!mcpRS) {
      const createRS = await managementService.createResourceServer({
        name: 'Demo MCP Server',
        audience: mcpUri,
        description: 'MCP Server resource server for token exchange audience',
      });
      if (!createRS.success) {
        return res.status(502).json({ success: false, error: `Could not create MCP RS: ${createRS.error}`, steps });
      }
      mcpRS = createRS.resourceServer;
      mcpRSCreated = true;
      steps.push({ step: 'create-mcp-rs', status: 'created', detail: `Created MCP RS with audience ${mcpUri}` });
    } else {
      steps.push({ step: 'find-mcp-rs', status: 'found', detail: `Found MCP RS: ${mcpRS.name} (${mcpRS.id})` });
    }

    // Step 2: Ensure all requested scopes exist on MCP RS
    const scopesResult = await managementService.getScopes(mcpRS.id);
    const existingNames = (scopesResult.scopes || []).map(s => s.name || s.value);
    const missingScopesOnRS = requestedScopes.filter(s => !existingNames.includes(s));
    const scopeCreateResults = await Promise.all(
      missingScopesOnRS.map(s =>
        managementService.createScopes(mcpRS.id, [{ name: s, description: `MCP scope: ${s}` }])
          .then(r => ({ scope: s, success: r[0]?.success ?? false, error: r[0]?.error }))
          .catch(e => ({ scope: s, success: false, error: e.message }))
      )
    );
    steps.push({ step: 'ensure-scopes', created: missingScopesOnRS, results: scopeCreateResults });

    // Step 3: Assign MCP RS + scopes to MCP Token Exchanger app
    // Re-fetch scopes to get actual names (may include ones just created)
    const freshScopesResult = await managementService.getScopes(mcpRS.id);
    const freshScopeNames = (freshScopesResult.scopes || [])
      .map(s => s.name || s.value)
      .filter(n => requestedScopes.includes(n));

    const apps = (await managementService.getApplications()).applications || [];
    const exchangerApp = apps.find(a => a.id === exchangerClientId || a.oidcOptions?.clientId === exchangerClientId);
    if (!exchangerApp) {
      steps.push({ step: 'assign-to-exchanger-app', status: 'skipped', detail: `Exchanger app ${exchangerClientId} not found` });
    } else {
      const assignResult = await managementService.enableResourceServer(exchangerApp.id, mcpRS.id, freshScopeNames);
      console.log('[fix-mcp-exchange] enableResourceServer result:', JSON.stringify(assignResult));
      steps.push({
        step: 'assign-to-exchanger-app',
        status: assignResult.success ? 'ok' : 'failed',
        detail: assignResult.success
          ? `Assigned ${freshScopeNames.join(', ')} on MCP RS to ${exchangerApp.name}${assignResult.patched ? ' (patched existing grant)' : ''}`
          : assignResult.error,
      });
    }

    // Step 4: Ensure "act" attribute mapping on MCP RS so the exchanged token
    // contains the act claim (who is acting on behalf of the user).
    // The SpEL pulls may_act from the subject token and emits it as "act".
    const axios = require('axios');
    const region = configStore.getEffective('pingone_region') || 'com';
    const envId = configStore.getEffective('pingone_environment_id');
    const apiBase = `https://api.pingone.${region}/v1/environments/${envId}`;
    const mgmtHeaders = { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' };
    const ACT_SPEL = '${#root.context.requestData.subjectToken.may_act}';

    try {
      const attrsRes = await axios.get(`${apiBase}/resources/${mcpRS.id}/attributes`, { headers: mgmtHeaders, timeout: 10000 });
      const rsAttrs = attrsRes.data?._embedded?.attributes || [];
      const existingAct = rsAttrs.find(a => a.name === 'act');

      if (existingAct) {
        // Check if the SpEL expression is the correct simple form
        if (existingAct.value === ACT_SPEL) {
          steps.push({ step: 'act-mapping', status: 'already_exists', detail: `act → ${ACT_SPEL}` });
        } else {
          // Fix: update to the correct SpEL (old expression may have a broken conditional)
          await axios.put(`${apiBase}/resources/${mcpRS.id}/attributes/${existingAct.id}`, {
            name: 'act',
            value: ACT_SPEL,
          }, { headers: mgmtHeaders, timeout: 10000 });
          steps.push({ step: 'act-mapping', status: 'fixed', detail: `Updated act SpEL from "${existingAct.value}" to "${ACT_SPEL}"` });
        }
      } else {
        await axios.post(`${apiBase}/resources/${mcpRS.id}/attributes`, {
          name: 'act',
          value: ACT_SPEL,
        }, { headers: mgmtHeaders, timeout: 10000 });
        steps.push({ step: 'act-mapping', status: 'created', detail: `act mapping added → ${ACT_SPEL}` });
      }
    } catch (actErr) {
      steps.push({ step: 'act-mapping', status: 'failed', detail: actErr.response?.data?.message || actErr.message });
    }

    // Step 5: Also ensure "may_act" attribute mapping on MCP RS so the
    // exchanged token can carry may_act if needed for downstream delegation.
    const MAY_ACT_SPEL = '${user.mayAct}';
    try {
      const attrsRes2 = await axios.get(`${apiBase}/resources/${mcpRS.id}/attributes`, { headers: mgmtHeaders, timeout: 10000 });
      const rsAttrs2 = attrsRes2.data?._embedded?.attributes || [];
      const existingMayAct = rsAttrs2.find(a => a.name === 'may_act');
      const existingCamel = rsAttrs2.find(a => a.name === 'mayAct');

      if (existingMayAct) {
        steps.push({ step: 'may_act-mapping-mcp', status: 'already_exists', detail: `may_act → ${existingMayAct.value}` });
      } else if (existingCamel) {
        // Fix camelCase → snake_case
        await axios.put(`${apiBase}/resources/${mcpRS.id}/attributes/${existingCamel.id}`, {
          name: 'may_act', value: MAY_ACT_SPEL,
        }, { headers: mgmtHeaders, timeout: 10000 });
        steps.push({ step: 'may_act-mapping-mcp', status: 'fixed', detail: 'Renamed "mayAct" → "may_act"' });
      }
      // Don't create may_act on MCP RS if not present — act is the primary claim here
    } catch (mayActErr) {
      steps.push({ step: 'may_act-mapping-mcp', status: 'failed', detail: mayActErr.response?.data?.message || mayActErr.message });
    }

    // Step 5b: Ensure "act" attribute mapping on the PingGateway resource.
    // When ff_mcp_gateway_pinggateway is on, the two-exchange FINAL exchange mints
    // its token against this resource (aud = PINGONE_RESOURCE_PINGGATEWAY_URI), not
    // the MCP Server RS above. PingOne only emits `act` if THIS resource carries the
    // act expression, so without it the final token has no act claim and the BFF
    // McpFirstTool gate / PingOne Authorize denies with invalid-actor-chain
    // (ActClientId="").
    //
    // At THIS final hop the act claim must PROPAGATE the subject token's existing
    // `act` (we use the act claim only — not may_act). The subject of Exchange #2 is
    // the Exchange #1 output token, which already carries act = { sub: <AI Agent> }.
    // Forwarding it keeps the AI Agent as the delegation actor the policy registers.
    // (The may_act-derived conditional used on the older Agent Gateway / MCP Gateway /
    // MCP Server resources does NOT work here: the intermediate token's may_act is
    // emitted as a JSON string, so may_act.sub never resolves and act evaluates null.)
    // Idempotent; skipped when the PingGateway resource isn't configured/found.
    const pingGatewayUri = configStore.getEffective('pingone_resource_pinggateway_uri')
      || process.env.PINGONE_RESOURCE_PINGGATEWAY_URI;
    const PINGGATEWAY_ACT_SPEL = '${#root.context.requestData.subjectToken.act}';
    if (!pingGatewayUri) {
      steps.push({ step: 'act-mapping-pinggateway', status: 'skipped', detail: 'pingone_resource_pinggateway_uri not configured' });
    } else {
      const pingGatewayRS = allRS.find(rs => (rs.audience || (rs.accessControl && rs.accessControl.audience) || '') === pingGatewayUri);
      if (!pingGatewayRS) {
        steps.push({ step: 'act-mapping-pinggateway', status: 'skipped', detail: `No resource server found for audience "${pingGatewayUri}"` });
      } else {
        try {
          const pgAttrsRes = await axios.get(`${apiBase}/resources/${pingGatewayRS.id}/attributes`, { headers: mgmtHeaders, timeout: 10000 });
          const pgAttrs = pgAttrsRes.data?._embedded?.attributes || [];
          const existingPgAct = pgAttrs.find(a => a.name === 'act');
          if (existingPgAct) {
            if (existingPgAct.value === PINGGATEWAY_ACT_SPEL) {
              steps.push({ step: 'act-mapping-pinggateway', status: 'already_exists', rs: pingGatewayRS.name, detail: 'act mapping present' });
            } else {
              await axios.put(`${apiBase}/resources/${pingGatewayRS.id}/attributes/${existingPgAct.id}`, {
                name: 'act', value: PINGGATEWAY_ACT_SPEL,
              }, { headers: mgmtHeaders, timeout: 10000 });
              steps.push({ step: 'act-mapping-pinggateway', status: 'fixed', rs: pingGatewayRS.name, detail: 'Updated act SpEL to propagate subjectToken.act' });
            }
          } else {
            await axios.post(`${apiBase}/resources/${pingGatewayRS.id}/attributes`, {
              name: 'act', value: PINGGATEWAY_ACT_SPEL,
            }, { headers: mgmtHeaders, timeout: 10000 });
            steps.push({ step: 'act-mapping-pinggateway', status: 'created', rs: pingGatewayRS.name, detail: `act mapping added on ${pingGatewayUri}` });
          }
        } catch (pgActErr) {
          steps.push({ step: 'act-mapping-pinggateway', status: 'failed', detail: pgActErr.response?.data?.message || pgActErr.message });
        }
      }
    }

    // Step 6: Verify audience on MCP RS matches PINGONE_RESOURCE_MCP_SERVER_URI
    try {
      if (mcpRS.audience !== mcpUri) {
        await axios.put(`${apiBase}/resources/${mcpRS.id}`, {
          name: mcpRS.name,
          audience: mcpUri,
          description: mcpRS.description || 'MCP Server resource server for token exchange audience',
        }, { headers: mgmtHeaders, timeout: 10000 });
        steps.push({ step: 'fix-audience', status: 'fixed', detail: `Updated MCP RS audience from "${mcpRS.audience}" to "${mcpUri}"` });
      } else {
        steps.push({ step: 'fix-audience', status: 'already_correct', detail: `Audience matches: ${mcpUri}` });
      }
    } catch (audErr) {
      steps.push({ step: 'fix-audience', status: 'failed', detail: audErr.response?.data?.message || audErr.message });
    }

    res.json({ success: true, mcpUri, mcpRSCreated, requestedScopes, steps });
  } catch (error) {
    console.error('[PingOneTest] fix-mcp-exchange error:', error.message);
    res.status(500).json({ success: false, error: 'Operation failed. Check server logs.' });
  }
});

/**
 * GET /api/pingone-test/ai-agent-apps
 * Fetch all applications from PingOne, filter to type=AI_AGENT,
 * and cross-reference against the known Demo AI App agent app names.
 */
router.get('/ai-agent-apps', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';
  try {
    await configStore.ensureInitialized();
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    try { managementService.initialize(workerToken); } catch (e) {
      return res.json({ success: false, error: 'Management API not configured: ' + e.message, apps: [] });
    }

    const result = await managementService.getApplications();
    const allApps = result.applications || [];
    const aiAgentApps = allApps.filter(a => a.type === 'AI_AGENT' || a.applicationType === 'AI_AGENT');

    const KNOWN_SUPER_BANKING_AI_APPS = [
      'Demo AI App - Token Exchanger',
      'Demo AI App - AI Agent Actor',
    ];
    const enriched = aiAgentApps.map(app => ({
      id: app.id,
      name: app.name,
      type: app.type || app.applicationType,
      isSuperBanking: KNOWN_SUPER_BANKING_AI_APPS.includes(app.name),
      clientId: app.oidcOptions?.clientId || app.clientId || null,
    }));
    const missing = KNOWN_SUPER_BANKING_AI_APPS.filter(n => !aiAgentApps.some(a => a.name === n));

    const responseData = {
      success: result.success,
      apps: enriched,
      count: enriched.length,
      totalApps: allApps.length,
      missingExpected: missing,
      error: result.error || null,
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Fetch AI_AGENT type applications from PingOne');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] ai-agent-apps error:', error.message);
    const responseData = { success: false, error: error.message, apps: [] };
    trackApiCall(sessionId, req, res, startTime, responseData, 'management-api', 'Fetch AI_AGENT type applications from PingOne');
    res.json(responseData);
  }
});

/**
 * POST /api/pingone-test/update-resources
 * Idempotently ensure both resource servers exist with correct audiences:
 *   - Banking RS  (ENDUSER_AUDIENCE) with canonical * scopes
 *   - MCP RS      (PINGONE_RESOURCE_MCP_SERVER_URI) with MCP scopes
 */
router.post('/update-resources', async (req, res) => {
  try {
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) {
      return res.status(503).json({ success: false, error: 'Worker token unavailable' });
    }
    managementService.initialize(workerToken);

    const audienceEnduser = configStore.getEffective('pingone_audience_enduser') || process.env.ENDUSER_AUDIENCE || 'enduser.ping.demo';
    const mcpUri = configStore.getEffective('pingone_resource_mcp_server_uri') || process.env.PINGONE_RESOURCE_MCP_SERVER_URI || 'mcpserver.ping.demo';

    const _sot = _sotExpectations();
    const RS_TARGETS = [
      { key: 'banking', name: scopeTopology.provisionedResourceName('Super Banking API'), audience: audienceEnduser,
        scopes: _sot.bankingScopes },
      { key: 'mcp',     name: scopeTopology.provisionedResourceName('Super Banking MCP Server'), audience: mcpUri,
        scopes: _sot.mcpScopes },
    ];

    const rsResult = await managementService.getResourceServers();
    const allRS = rsResult.resourceServers || [];
    const steps = [];

    for (const target of RS_TARGETS) {
      const existing = allRS.find(rs => {
        const aud = rs.audience || (rs.accessControl && rs.accessControl.audience) || '';
        return aud === target.audience || (rs.name || '').toLowerCase().includes(target.key);
      });

      let rsId;
      if (!existing) {
        const cr = await managementService.createResourceServer({ name: target.name, audience: target.audience, description: `${target.name} resource server` });
        if (!cr.success) { steps.push({ rs: target.name, status: 'failed', detail: cr.error }); continue; }
        rsId = cr.resourceServer?.id || cr.id;
        steps.push({ rs: target.name, status: 'created', audience: target.audience });
      } else {
        rsId = existing.id;
        steps.push({ rs: target.name, status: 'found', audience: existing.audience });
      }

      const existingScopes = await managementService.getScopes(rsId);
      const existingNames = (existingScopes.scopes || []).map(s => s.name || s.value || s);
      const toAdd = target.scopes.filter(s => !existingNames.includes(s));
      if (toAdd.length > 0) {
        const scopeResults = await Promise.all(
          toAdd.map(s => managementService.createScopes(rsId, [{ name: s, description: `Scope: ${s}` }])
            .then(r => ({ scope: s, success: r[0]?.success ?? false, error: r[0]?.error }))
            .catch(e => ({ scope: s, success: false, error: e.message })))
        );
        steps.push({ rs: target.name, scopesAdded: toAdd, scopeResults });
      } else {
        steps.push({ rs: target.name, scopesAdded: [], detail: 'All canonical scopes already present' });
      }
    }

    res.json({ success: true, steps });
  } catch (error) {
    console.error('[PingOneTest] update-resources error:', error.message);
    res.status(500).json({ success: false, error: 'Operation failed. Check server logs.' });
  }
});

/**
 * POST /api/pingone-test/update-scopes
 * Add any missing canonical scopes to the Banking RS and MCP RS.
 * Non-destructive: only adds, never removes.
 */
router.post('/update-scopes', async (req, res) => {
  try {
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) {
      return res.status(503).json({ success: false, error: 'Worker token unavailable' });
    }
    managementService.initialize(workerToken);

    const audienceEnduser = configStore.getEffective('pingone_audience_enduser') || process.env.ENDUSER_AUDIENCE || 'enduser.ping.demo';
    const mcpUri = configStore.getEffective('pingone_resource_mcp_server_uri') || process.env.PINGONE_RESOURCE_MCP_SERVER_URI || 'mcpserver.ping.demo';
    const _sot = _sotExpectations();
    const SCOPE_MAP = {
      enduser: { audience: audienceEnduser, scopes: _sot.bankingScopes },
      mcp:     { audience: mcpUri,         scopes: _sot.mcpScopes },
    };

    const rsResult = await managementService.getResourceServers();
    const allRS = rsResult.resourceServers || [];
    const results = [];

    for (const [key, target] of Object.entries(SCOPE_MAP)) {
      const rs = allRS.find(r => {
        const aud = r.audience || (r.accessControl && r.accessControl.audience) || '';
        return aud === target.audience || (r.name || '').toLowerCase().includes(key);
      });
      if (!rs) { results.push({ rs: key, status: 'not_found', audience: target.audience }); continue; }

      const existing = await managementService.getScopes(rs.id);
      const existingNames = (existing.scopes || []).map(s => s.name || s.value || s);
      const toAdd = target.scopes.filter(s => !existingNames.includes(s));

      const scopeResults = await Promise.all(
        toAdd.map(s => managementService.createScopes(rs.id, [{ name: s, description: `Scope: ${s}` }])
          .then(r => ({ scope: s, success: r[0]?.success ?? false }))
          .catch(e => ({ scope: s, success: false, error: e.message })))
      );
      results.push({ rs: rs.name, added: toAdd, alreadyPresent: existingNames.filter(n => target.scopes.includes(n)), scopeResults });
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('[PingOneTest] update-scopes error:', error.message);
    res.status(500).json({ success: false, error: 'Operation failed. Check server logs.' });
  }
});

/**
 * POST /api/pingone-test/update-apps
 * For each Demo AI App, ensure it has the correct banking RS scopes granted.
 * Non-destructive: enableResourceServer merges (existing ∪ required), never removes.
 * Also finds all AI_AGENT apps and includes them in the response.
 */
router.post('/update-apps', async (req, res) => {
  try {
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) {
      return res.status(503).json({ success: false, error: 'Worker token unavailable' });
    }
    managementService.initialize(workerToken);

    const audienceEnduser = configStore.getEffective('pingone_audience_enduser') || process.env.ENDUSER_AUDIENCE || 'enduser.ping.demo';
    const _sot = _sotExpectations();

    // Real app name → FULL expected grant (scope-topology apps[].grantedScopes).
    // enableResourceServer merges (existing ∪ required) and skips scope names that
    // don't yet exist on the RS, so this is non-destructive.
    const APP_SCOPE_REQUIREMENTS = _sot.requiredScopesPerApp;

    // Find banking RS
    const rsResult = await managementService.getResourceServers();
    const allRS = rsResult.resourceServers || [];
    const bankingRS = allRS.find(rs => {
      const aud = rs.audience || (rs.accessControl && rs.accessControl.audience) || '';
      return aud === audienceEnduser || (rs.name || '').toLowerCase().includes('banking');
    });
    if (!bankingRS) {
      return res.json({ success: false, error: 'Banking resource server not found. Run Update Resources first.' });
    }

    // Get all RS scopes for name lookup
    const rsScopesResult = await managementService.getScopes(bankingRS.id);
    const rsScopesList = rsScopesResult.scopes || [];

    // Get apps
    const appsResult = await managementService.getApplications();
    const allApps = appsResult.applications || [];

    // AI_AGENT apps — discovery
    const aiAgentApps = allApps.filter(a => a.type === 'AI_AGENT' || a.applicationType === 'AI_AGENT');

    const steps = [];
    for (const [appName, requiredScopes] of Object.entries(APP_SCOPE_REQUIREMENTS)) {
      const app = allApps.find(a => a.name === appName);
      if (!app) { steps.push({ app: appName, status: 'not_found' }); continue; }

      const assignResult = await managementService.enableResourceServer(app.id, bankingRS.id, requiredScopes);
      steps.push({
        app: appName,
        appId: app.id,
        status: assignResult.success ? 'ok' : 'failed',
        detail: assignResult.success
          ? `Granted: ${requiredScopes.join(', ')} on ${bankingRS.name}${assignResult.patched ? ' (patched)' : ''}`
          : assignResult.error,
      });
    }

    res.json({
      success: true,
      steps,
      aiAgentApps: aiAgentApps.map(a => ({ id: a.id, name: a.name, type: a.type || a.applicationType })),
    });
  } catch (error) {
    console.error('[PingOneTest] update-apps error:', error.message);
    res.status(500).json({ success: false, error: 'Operation failed. Check server logs.' });
  }
});

/**
 * POST /api/pingone-test/update-user-spel
 * Two-step setup so may_act actually appears in the user's access token:
 *   1. PATCH the user's `mayAct` custom attribute  → PingOne stores the value.
 *   2. Ensure a `may_act` attribute mapping exists on the OIDC app(s)
 *      (Demo AI App - User Login + Demo AI App - Admin Login) so PingOne
 *      serialises the stored value into the access token's `may_act` claim.
 *
 * Both steps are idempotent. Without step 2 the user attribute is set but
 * the token never contains `may_act` — which is the most common "still no
 * may_act" scenario.
 *
 * Body: { enabled: boolean, userId?: string }
 */
router.post('/update-user-spel', async (req, res) => {
  try {
    await configStore.ensureInitialized();

    const { enabled = true } = req.body;
    const sessionUser = req.session?.user;
    // Security: always use session user — never accept userId from client (BOLA prevention)
    const pingOneUserId = sessionUser?.oauthId || sessionUser?.id;

    if (!pingOneUserId) {
      return res.json({ success: false, error: 'No user ID available. User must be logged in or supply userId.' });
    }

    const region  = configStore.getEffective('pingone_region') || 'com';
    const envId   = configStore.getEffective('pingone_environment_id');
    // may_act.sub must point to the MCP Token Exchanger — it's the app that
    // performs the RFC 8693 token exchange on behalf of the user.
    const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id')
      || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
    // Fallback to admin/agent client if exchanger not configured
    const bffClientId = exchangerClientId
      || configStore.getEffective('admin_client_id')
      || configStore.getEffective('pingone_ai_agent_client_id');

    if (!bffClientId) {
      return res.json({ success: false, error: 'MCP Token Exchanger client ID not set — cannot determine may_act.sub value.' });
    }

    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) {
      return res.status(503).json({ success: false, error: 'Worker token unavailable' });
    }

    const axios = require('axios');
    const base = `https://api.pingone.${region}/v1/environments/${envId}`;
    const headers = { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' };
    const steps = [];

    // ── Step 1: PATCH mayAct on user record ──────────────────────────────────
    const patch = { mayAct: enabled ? { sub: bffClientId } : null };
    await axios.patch(`${base}/users/${pingOneUserId}`, patch, { headers });
    steps.push({ step: 'user-attribute', status: 'ok', detail: enabled ? `mayAct.sub = "${bffClientId}"` : 'mayAct cleared' });

    // ── Step 2: Ensure may_act attribute mapping on Resource Servers ─────────
    // For custom RS access tokens, attribute mappings must be on the RESOURCE
    // SERVER, not the OIDC app. App-level mappings only go to idToken/userInfo.
    // The RS attribute name becomes the JWT claim name, so it must be "may_act"
    // (snake_case per RFC 8693), NOT "mayAct" (camelCase).
    if (enabled) {
      const audienceEnduser = configStore.getEffective('pingone_audience_enduser') || process.env.ENDUSER_AUDIENCE;
      const mcpUri = configStore.getEffective('pingone_resource_mcp_server_uri') || process.env.PINGONE_RESOURCE_MCP_SERVER_URI;

      // Discover all resource servers
      managementService.initialize(workerToken);
      const rsResult = await managementService.getResourceServers();
      const allRS = rsResult.resourceServers || [];

      // RS targets that need may_act: Banking API RS and AI Agent RS
      // (MCP Server RS needs "act" not "may_act" — handled by fix-mcp-exchange)
      const rsTargets = [];
      for (const rs of allRS) {
        const aud = rs.audience || (rs.accessControl && rs.accessControl.audience) || '';
        const name = (rs.name || '').toLowerCase();
        // Match Banking API RS, AI Agent RS, or any RS with a banking/agent audience
        if (aud === audienceEnduser || aud === 'https://resource-server.pingdemo.com'
            || aud === 'agentgateway.ping.demo'
            || name.includes('banking') || name.includes('ai agent')) {
          rsTargets.push(rs);
        }
      }

      for (const rs of rsTargets) {
        const rsAttrsRes = await axios.get(`${base}/resources/${rs.id}/attributes`, { headers, timeout: 10000 });
        const rsAttrs = rsAttrsRes.data?._embedded?.attributes || [];

        // Check for existing may_act (correct name) or mayAct (wrong camelCase name)
        const existingCorrect = rsAttrs.find(a => a.name === 'may_act');
        const existingCamel = rsAttrs.find(a => a.name === 'mayAct');

        if (existingCorrect) {
          steps.push({ step: 'rs-mapping', rs: rs.name, status: 'already_exists', detail: `may_act → ${existingCorrect.value}` });
        } else if (existingCamel) {
          // Fix: rename mayAct → may_act (PingOne uses attribute name as JWT claim name)
          try {
            await axios.put(`${base}/resources/${rs.id}/attributes/${existingCamel.id}`, {
              name: 'may_act',
              value: '${user.mayAct}',
            }, { headers, timeout: 10000 });
            steps.push({ step: 'rs-mapping', rs: rs.name, status: 'fixed', detail: 'Renamed "mayAct" → "may_act" (RFC 8693 snake_case)' });
          } catch (fixErr) {
            steps.push({ step: 'rs-mapping', rs: rs.name, status: 'fix_failed', detail: fixErr.response?.data?.message || fixErr.message });
          }
        } else {
          // Create may_act attribute mapping on this RS
          try {
            await axios.post(`${base}/resources/${rs.id}/attributes`, {
              name: 'may_act',
              value: '${user.mayAct}',
            }, { headers, timeout: 10000 });
            steps.push({ step: 'rs-mapping', rs: rs.name, status: 'created', detail: 'may_act mapping added → ${user.mayAct}' });
          } catch (mapErr) {
            steps.push({ step: 'rs-mapping', rs: rs.name, status: 'failed', detail: mapErr.response?.data?.message || mapErr.message });
          }
        }
      }

      if (rsTargets.length === 0) {
        steps.push({ step: 'rs-mapping', status: 'skipped', detail: 'No Banking/AI Agent resource servers found to map may_act on' });
      }

      // ── Step 3: Ensure may_act attribute mapping on OIDC apps (id_token/userinfo) ──
      const userClientId  = configStore.getEffective('user_client_id');
      const adminClientId = configStore.getEffective('admin_client_id');
      const targetClientIds = [...new Set([userClientId, adminClientId].filter(Boolean))];

      const appsRes = await axios.get(`${base}/applications?limit=100`, { headers, timeout: 10000 });
      const apps = appsRes.data?._embedded?.applications || [];

      for (const clientId of targetClientIds) {
        const app = apps.find(a => a.protocol === 'OPENID_CONNECT' && (a.oidcOptions?.clientId === clientId || a.id === clientId));
        if (!app) {
          steps.push({ step: 'app-mapping', appClientId: clientId, status: 'skipped', detail: `OIDC app not found for clientId "${clientId}"` });
          continue;
        }

        const mappingsRes = await axios.get(`${base}/applications/${app.id}/attributes`, { headers, timeout: 10000 });
        const mappings = mappingsRes.data?._embedded?.attributes || [];
        const existing = mappings.find(m => m.name === 'may_act');

        if (existing) {
          steps.push({ step: 'app-mapping', app: app.name, status: 'already_exists', detail: `Mapping expression: "${existing.value}"` });
        } else {
          try {
            await axios.post(`${base}/applications/${app.id}/attributes`, {
              name: 'may_act',
              value: '(#root.user.mayAct != null ? #root.user.mayAct : null)',
              required: false,
            }, { headers, timeout: 10000 });
            steps.push({ step: 'app-mapping', app: app.name, status: 'created', detail: 'may_act mapping added for id_token/userinfo' });
          } catch (mapErr) {
            steps.push({ step: 'app-mapping', app: app.name, status: 'failed', detail: mapErr.response?.data?.message || mapErr.message });
          }
        }
      }
    }

    console.log(`[PingOneTest] mayAct ${enabled ? 'set' : 'cleared'} on user ${pingOneUserId} → sub: ${bffClientId} (exchanger)`);
    res.json({
      success: true,
      userId: pingOneUserId,
      mayAct: patch.mayAct,
      steps,
      message: enabled
        ? `mayAct.sub set to "${bffClientId}" (exchanger app) on user ${pingOneUserId}. Attribute mapping ensured on resource servers + OIDC apps. User must re-login for token to reflect this.`
        : `mayAct cleared on user ${pingOneUserId}.`,
    });
  } catch (error) {
    console.error('[PingOneTest] update-user-spel error:', error.message);
    res.status(500).json({ success: false, error: 'Operation failed. Check server logs.' });
  }
});


/**
 * GET /api/pingone-test/exchange-1token-401-flow
 * Phase 187: Probe MCP with raw user access token (expect 401),
 * fetch fresh agent CC token, perform RFC 8693 1-token exchange
 * (subject only, no actor), retry MCP with exchanged MCP token.
 */
router.get('/exchange-1token-401-flow', async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.query.sessionId || 'pingone-test';
  const steps = [];

  try {
    // Step 0: Validate session
    const oauthTokens = req.session.oauthTokens;
    const userAccessToken = oauthTokens?.accessToken || oauthTokens?.access_token;
    if (!userAccessToken) {
      const responseData = { success: false, error: 'No user access token in session. Log in first.' };
      trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Phase 187: 1-token 401 flow');
      return res.json(responseData);
    }

    await configStore.ensureInitialized();
    const rawMcpUrl = process.env.MCP_SERVER_URL || configStore.getEffective('mcp_server_url') || 'ws://localhost:8080';
    const httpMcpUrl = rawMcpUrl.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
    const postUrl = new URL('/mcp', httpMcpUrl).toString();

    // Helper: HTTP POST to MCP with given bearer token
    function probeMcp(token) {
      return new Promise((resolve) => {
        const parsedUrl = new URL(postUrl);
        const isHttps = parsedUrl.protocol === 'https:';
        const transport = isHttps ? https : http;
        const payload = JSON.stringify({
          jsonrpc: '2.0', method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: '401-probe', version: '1.0' } },
          id: 1
        });
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Authorization': `Bearer ${token}`
          }
        };

        let resolved = false;
        const request = transport.request(options, (response) => {
          let body = '';
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => {
            if (!resolved) {
              resolved = true;
              resolve({ status: response.statusCode, body });
            }
          });
        });

        // Allow up to 35s — MCP server introspects the token with PingOne (30s timeout).
        const timeoutHandle = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            request.destroy();
            resolve({ status: 0, body: 'MCP probe timeout (35s) — server did not respond' });
          }
        }, 35000);

        request.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutHandle);
            resolve({ status: 0, body: err.message });
          }
        });

        request.on('close', () => {
          clearTimeout(timeoutHandle);
        });

        request.write(payload);
        request.end();
      });
    }

    // Step 1: Probe MCP with raw user access token (expect 401)
    const probe = await probeMcp(userAccessToken);
    steps.push({
      step: 1,
      label: 'Probe MCP with user access token (no exchange)',
      status: probe.status,
      expected: 401,
      received: probe.status,
      passed: probe.status === 401
    });

    // Step 2: Fetch fresh agent CC token
    const agentToken = await oauthService.getMcpExchangerToken();
    const agentDecoded = decodeJwtForDisplay(agentToken);
    steps.push({
      step: 2,
      label: 'Agent fetches own CC token (MCP Exchanger)',
      status: 200,
      passed: !!agentToken
    });

    // Step 3: 1-token exchange (user access token → MCP token)
    const mcpResourceUri = configStore.getEffective('mcp_resource_uri')
      || configStore.getEffective('pingone_resource_mcp_gateway_uri');
    const mcpScopes = (process.env.MCP_TOKEN_EXCHANGE_SCOPES || 'read write mcp:invoke').trim().split(/\s+/);
    let mcpToken = null;
    let exchangeError = null;
    try {
      mcpToken = await oauthService.performTokenExchange(userAccessToken, mcpResourceUri, mcpScopes);
    } catch (exErr) {
      exchangeError = exErr.message;
    }
    const mcpDecoded = mcpToken ? decodeJwtForDisplay(mcpToken) : null;
    steps.push({
      step: 3,
      label: 'RFC 8693 1-token exchange (user → MCP token)',
      status: mcpToken ? 200 : 400,
      passed: !!mcpToken,
      error: exchangeError || undefined
    });

    // Step 4: Retry MCP with exchanged MCP token
    let retryResult = { status: 0, body: 'skipped — no MCP token' };
    if (mcpToken) {
      retryResult = await probeMcp(mcpToken);
    }
    steps.push({
      step: 4,
      label: 'Retry MCP with exchanged MCP token',
      status: retryResult.status,
      received: retryResult.status,
      passed: mcpToken ? retryResult.status !== 401 : false
    });

    const subjectDecoded = decodeJwtForDisplay(userAccessToken);
    const tokenEvents = [
      buildExchangeTokenEvent('user-access-token', 'User Access Token (subject)', 'active', subjectDecoded, 'Raw user access token from OIDC session — sent to MCP first (causes 401)'),
      buildExchangeTokenEvent('agent-cc-token', 'Agent Token (MCP Exchanger CC)', 'active', agentDecoded, 'Client Credentials token from MCP Exchanger app — agent authenticates independently'),
      buildExchangeTokenEvent('mcp-token', 'MCP Access Token', mcpToken ? 'active' : 'failed', mcpDecoded, 'RFC 8693 1-token exchange result — subject-only exchange, aud narrowed to MCP server'),
    ];

    const _tokenEp401 = oauthService.config?.tokenEndpoint;
    const responseData = {
      success: !!mcpToken,
      steps,
      decoded: mcpDecoded,
      agentTokenDecoded: agentDecoded,
      subjectTokenDecoded: subjectDecoded,
      tokenEvents,
      pingoneRequest: _tokenEp401 ? _p1ReqDebug('POST', _tokenEp401, 'application/x-www-form-urlencoded', {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: mcpResourceUri,
        scope: mcpScopes.join(' '),
      }) : undefined,
      pingoneResponse: mcpDecoded ? { token_type: 'Bearer', scope: mcpDecoded.payload?.scope } : undefined,
    };
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Phase 187: 1-token 401 flow');
    res.json(responseData);
  } catch (error) {
    console.error('[PingOneTest] Phase 187 1-token 401 flow error:', error.message);
    const responseData = { success: false, error: error.message, steps };
    trackApiCall(sessionId, req, res, startTime, responseData, 'token-exchange', 'Phase 187: 1-token 401 flow');
    res.json(responseData);
  }
});

/**
 * GET /api/pingone-test/check-ai-agent-act
 * Check whether the AI-Agent resource (banking enduser audience) has an "act" claim
 * attribute mapping with the correct SPEL expression for RFC 8693 delegation.
 */
router.get('/check-ai-agent-act', async (req, res) => {
  try {
    await configStore.ensureInitialized();
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) return res.status(503).json({ status: 'error', detail: 'Worker token unavailable' });

    const axios = require('axios');
    const region = configStore.getEffective('pingone_region') || 'com';
    const envId  = configStore.getEffective('pingone_environment_id');
    const audienceEnduser = configStore.getEffective('pingone_audience_enduser') || 'agentgateway.ping.demo';
    const apiBase = `https://api.pingone.${region}/v1/environments/${envId}`;
    const mgmtHeaders = { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' };
    const ACT_SPEL = '{"sub":"${tokenContext.actor.sub}"}';

    // Find the AI-Agent resource by audience
    const rsRes = await axios.get(`${apiBase}/resources`, { headers: mgmtHeaders, timeout: 10000 });
    const allRS = rsRes.data?._embedded?.resources || [];
    const aiAgentRS = allRS.find(r => r.audience === audienceEnduser);

    if (!aiAgentRS) {
      return res.json({ status: 'missing_resource', detail: `No resource found with audience ${audienceEnduser}` });
    }

    const attrsRes = await axios.get(`${apiBase}/resources/${aiAgentRS.id}/attributes`, { headers: mgmtHeaders, timeout: 10000 });
    const attrs = attrsRes.data?._embedded?.attributes || [];
    const existingAct = attrs.find(a => a.name === 'act');

    if (!existingAct) {
      return res.json({ status: 'missing', resourceId: aiAgentRS.id, resourceName: aiAgentRS.name, audience: audienceEnduser });
    }
    if (existingAct.value === ACT_SPEL) {
      return res.json({ status: 'ok', attributeId: existingAct.id, value: existingAct.value, resourceId: aiAgentRS.id, audience: audienceEnduser });
    }
    return res.json({ status: 'wrong_value', attributeId: existingAct.id, currentValue: existingAct.value, expectedValue: ACT_SPEL, resourceId: aiAgentRS.id, audience: audienceEnduser });
  } catch (err) {
    console.error('[PingOneTest] check-ai-agent-act error:', err.message);
    const n = normalizeAxiosError(err, { label: 'PingOne test call' });
    res.status(500).json({ status: 'error', detail: n.message });
  }
});

/**
 * POST /api/pingone-test/fix-ai-agent-act
 * Create (or correct) the "act" attribute on the AI-Agent resource so that
 * RFC 8693 exchanged tokens include the act claim with the actor subject.
 */
router.post('/fix-ai-agent-act', async (req, res) => {
  try {
    await configStore.ensureInitialized();
    const workerToken = await oauthService.getAgentClientCredentialsToken();
    if (!workerToken) return res.status(503).json({ success: false, error: 'Worker token unavailable' });

    const axios = require('axios');
    const region = configStore.getEffective('pingone_region') || 'com';
    const envId  = configStore.getEffective('pingone_environment_id');
    const audienceEnduser = configStore.getEffective('pingone_audience_enduser') || 'agentgateway.ping.demo';
    const apiBase = `https://api.pingone.${region}/v1/environments/${envId}`;
    const mgmtHeaders = { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' };
    const ACT_SPEL = '{"sub":"${tokenContext.actor.sub}"}';

    // Find resource by audience
    const rsRes = await axios.get(`${apiBase}/resources`, { headers: mgmtHeaders, timeout: 10000 });
    const allRS = rsRes.data?._embedded?.resources || [];
    const aiAgentRS = allRS.find(r => r.audience === audienceEnduser);
    if (!aiAgentRS) {
      return res.json({ success: false, error: `No resource found with audience ${audienceEnduser}` });
    }

    const attrsRes = await axios.get(`${apiBase}/resources/${aiAgentRS.id}/attributes`, { headers: mgmtHeaders, timeout: 10000 });
    const attrs = attrsRes.data?._embedded?.attributes || [];
    const existingAct = attrs.find(a => a.name === 'act');

    let action;
    if (!existingAct) {
      await axios.post(`${apiBase}/resources/${aiAgentRS.id}/attributes`, { name: 'act', value: ACT_SPEL }, { headers: mgmtHeaders, timeout: 10000 });
      action = 'created';
    } else if (existingAct.value !== ACT_SPEL) {
      await axios.put(`${apiBase}/resources/${aiAgentRS.id}/attributes/${existingAct.id}`, { name: 'act', value: ACT_SPEL }, { headers: mgmtHeaders, timeout: 10000 });
      action = 'updated';
    } else {
      action = 'already_correct';
    }

    console.log(`[PingOneTest] fix-ai-agent-act: ${action} on resource ${aiAgentRS.id} (${audienceEnduser})`);
    res.json({ success: true, action, audience: audienceEnduser, resourceId: aiAgentRS.id, value: ACT_SPEL });
  } catch (err) {
    console.error('[PingOneTest] fix-ai-agent-act error:', err.message);
    const n = normalizeAxiosError(err, { label: 'PingOne test call' });
    res.status(500).json({ success: false, error: n.message });
  }
});

module.exports = router;
