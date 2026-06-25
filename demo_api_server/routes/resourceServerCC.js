const express = require('express');
const router = express.Router();
const oauthService = require('../services/oauthService');
const { decodeJwtClaims } = require('../services/agentMcpTokenService');

/**
 * GET /api/resource-server-cc/summary
 * Returns CC token claims + demo banking data for display on the Client Credentials Resource Server page.
 * Demonstrates what a machine-to-machine client sees — no user identity, no delegation claims.
 *
 * Raw CC token never sent to client — only decoded claims.
 * Requires any authenticated OIDC session (mounted behind authenticateToken). The CC token
 * is fetched server-side to demonstrate what a machine client would receive; it is NOT the
 * caller's own token, so no elevated (admin) role is needed to view this teaching demo.
 */
router.get('/summary', async (_req, res) => {
  // Fetch a Client Credentials token server-side to demonstrate CC grant
  let ccTokenClaims = {};
  let tokenMetadata = {};
  let ccError = null;

  try {
    const ccToken = await oauthService.getAgentClientCredentialsToken();
    const decoded = decodeJwtClaims(ccToken);
    const claims = decoded?.claims || {};

    ccTokenClaims = claims;

    const scopeStr = typeof claims.scope === 'string' ? claims.scope : '';
    tokenMetadata = {
      grantType: 'client_credentials',
      audience: claims.aud || null,
      scopes: scopeStr ? scopeStr.split(' ').filter(Boolean) : (Array.isArray(claims.scope) ? claims.scope : []),
      expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
      issuedAt: claims.iat ? new Date(claims.iat * 1000).toISOString() : null,
      issuer: claims.iss || null,
      // CC tokens explicitly do NOT have these claims:
      hasSubClaim: false,
      hasActClaim: false,
      hasNameOrEmail: false,
    };
  } catch (err) {
    // Graceful degradation — return informational payload instead of 500
    ccError = {
      error: 'cc_not_configured',
      message: err.message || 'Client credentials token fetch failed.',
      configNeeded: [
        'PINGONE_WORKER_TOKEN_CLIENT_ID',
        'PINGONE_WORKER_TOKEN_CLIENT_SECRET',
      ],
    };
  }

  // Static demo accounts — CC has no user context so no real user accounts exist
  const accounts = [
    {
      id: 'svc-1',
      accountType: 'service',
      accountNumber: 'SVC-DEMO-0001',
      balance: 0,
      currency: 'USD',
      label: 'Service Account (no user balances in CC mode)',
    },
  ];

  const resourceServerInfo = {
    name: 'Banking API Resource Server (Client Credentials)',
    type: 'Client Credentials',
    description: 'Machine-to-machine access via client_id + client_secret — no user context',
    authMethod: 'Client Credentials Grant (OAuth 2.0 §4.4)',
    note: 'This token has NO sub claim — it represents the application, not a user',
  };

  const comparison = {
    oidc: {
      label: 'OIDC Authorization Code + PKCE (Phase 191)',
      hasSubClaim: true,
      hasActClaim: true,
      hasUserData: true,
      description:
        'User authenticates → access_token with sub (user identity) + act (agent delegation) → resource server validates user context',
    },
    cc: {
      label: 'Client Credentials (This page)',
      hasSubClaim: false,
      hasActClaim: false,
      hasUserData: false,
      description:
        'Application authenticates with client_id/secret → access_token with client_id only → NO user identity, NO delegation chain',
    },
  };

  res.json({
    accounts,
    ccTokenClaims,
    tokenMetadata,
    resourceServerInfo,
    comparison,
    ...(ccError && { ccError }),
  });
});

module.exports = router;
