const express = require('express');
const router = express.Router();
const dataStore = require('../data/store');
const { getBffResourceAudience, getInFlowResourceAudience } = require('../config/resourceAudience');
const { latestCachedMcpToken } = require('../services/resourceServerTesterService');
const { decodeJwtClaims, sanitizeClaims } = require('../services/agentMcpTokenService');

/**
 * GET /api/resource-server/summary
 * Returns banking summary + decoded token claims for display on the OIDC Resource Server page.
 * Raw tokens NEVER leave the server — only decoded/sanitized claims are sent.
 */
router.get('/summary', (req, res) => {
  // Require authenticated session
  if (!req.session || !req.session.oauthTokens || !req.session.oauthTokens.accessToken || req.session.oauthTokens.accessToken === '_cookie_session') {
    return res.status(401).json({ error: 'authentication_required', message: 'Please log in to access the OIDC Resource Server.' });
  }

  try {
    const accessToken = req.session.oauthTokens.accessToken;
    const idToken = req.session.oauthTokens.idToken;

    // Decode tokens (no signature verification — display only)
    const accessDecoded = decodeJwtClaims(accessToken);
    const idDecoded = decodeJwtClaims(idToken);

    const accessClaims = sanitizeClaims(accessDecoded?.claims) || {};
    const idClaims = sanitizeClaims(idDecoded?.claims) || {};

    // Get user accounts
    const userId = req.session.user?.id || req.session.user?.sub;
    const accounts = userId ? dataStore.getAccountsByUserId(userId) : [];
    const formattedAccounts = accounts.map(a => ({
      id: a.id,
      accountType: a.accountType,
      name: a.name,
      balance: a.balance,
      currency: a.currency || 'USD',
      status: a.status || 'active',
      accountNumber: a.accountNumber || ('****' + (a.accountNumberFull || '').slice(-4)),
    }));

    // Get recent transactions
    const transactions = userId ? dataStore.getTransactionsByUserId(userId).slice(0, 5) : [];
    const formattedTransactions = transactions.map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      description: t.description || t.type,
      createdAt: t.createdAt,
    }));

    // Build token metadata
    const rawClaims = accessDecoded?.claims || {};
    // This page IS the BFF banking resource server, so its target audience is the BFF
    // audience the user's login token carries (and authenticateToken enforces) — NOT the
    // MCP server audience, which only the RFC 8693-exchanged token carries.
    const resourceUri = getBffResourceAudience();

    const tokenMetadata = {
      audience: rawClaims.aud || null,
      scopes: typeof rawClaims.scope === 'string' ? rawClaims.scope.split(' ').filter(Boolean) : (Array.isArray(rawClaims.scope) ? rawClaims.scope : []),
      expiresAt: rawClaims.exp ? new Date(rawClaims.exp * 1000).toISOString() : null,
      issuedAt: rawClaims.iat ? new Date(rawClaims.iat * 1000).toISOString() : null,
      issuer: rawClaims.iss || null,
      actorClaim: rawClaims.act || null,
    };

    const resourceServerInfo = {
      name: 'Banking API Resource Server (Login)',
      type: 'OIDC',
      description: 'User-delegated access via OIDC Authorization Code + PKCE — first-hop login audience',
      authMethod: 'Bearer token (access_token from PingOne)',
      targetAudience: resourceUri,
      view: 'login',
    };

    res.json({
      accounts: formattedAccounts,
      transactions: formattedTransactions,
      accessTokenClaims: accessClaims,
      idTokenClaims: idClaims,
      tokenMetadata,
      resourceServerInfo,
    });
  } catch (error) {
    console.error('[resource-server] summary error:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to build resource server summary.' });
  }
});

/**
 * GET /api/resource-server/summary-inflow — in-flow (gateway TX) RS teaching summary.
 * Uses a cached agent MCP token when present; does not mint on GET.
 */
router.get('/summary-inflow', (req, res) => {
  // Same session gate as /summary — cookie-session stub / missing AT must 401.
  if (!req.session || !req.session.oauthTokens || !req.session.oauthTokens.accessToken || req.session.oauthTokens.accessToken === '_cookie_session') {
    return res.status(401).json({ error: 'authentication_required', message: 'Please log in to access the OIDC Resource Server.' });
  }

  try {
    const resourceUri = getInFlowResourceAudience();
    const mcpToken = latestCachedMcpToken(req.session);
    let accessTokenClaims = null;
    let tokenMetadata = null;
    if (mcpToken) {
      const decoded = decodeJwtClaims(mcpToken);
      const rawClaims = (decoded && decoded.claims) || {};
      accessTokenClaims = rawClaims;
      tokenMetadata = {
        audience: rawClaims.aud || null,
        scopes: typeof rawClaims.scope === 'string'
          ? rawClaims.scope.split(' ').filter(Boolean)
          : (Array.isArray(rawClaims.scope) ? rawClaims.scope : []),
        expiresAt: rawClaims.exp ? new Date(rawClaims.exp * 1000).toISOString() : null,
        issuedAt: rawClaims.iat ? new Date(rawClaims.iat * 1000).toISOString() : null,
        issuer: rawClaims.iss || null,
        actorClaim: rawClaims.act || null,
      };
    }

    res.json({
      hasMcpToken: !!mcpToken,
      accessTokenClaims,
      idTokenClaims: null,
      tokenMetadata,
      resourceServerInfo: {
        name: 'In-flow Resource Server (Gateway Path B)',
        type: 'OIDC + RFC 8693',
        description: 'Same /api/resource-server hop the MCP gateway dual_token disposition calls (e.g. POST /identity) with the exchanged gateway-audience bearer',
        authMethod: 'Bearer TX token (aud=MCP gateway) + optional id_token on POST /identity',
        targetAudience: resourceUri,
        probeHint: '/api/resource-server/identity',
        view: 'inflow',
      },
    });
  } catch (error) {
    console.error('[resource-server] summary-inflow error:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to build in-flow resource server summary.' });
  }
});

// ─── Phase 266 R2: new routes — /identity, /accounts, /transactions ──────────

const bankingDb     = require('../services/bankingDb');
const { scrubRawJwts } = require('../services/jwtScrubber');

/**
 * GET /api/resource-server/identity — SPA direct-fetch path (session fallback)
 * POST /api/resource-server/identity — Gateway dual_token path (wire-forwarded id_token)
 *
 * Phase 266 R2 Path B endpoint. Accepts BOTH verbs via a shared handler.
 *
 * POST: used by the gateway in the dual_token disposition. The gateway sends a
 *       JSON-RPC envelope: { jsonrpc, method:'identity.show', params:{ idToken } }.
 *       The id_token rides in req.body.params.idToken.
 *
 * GET:  used by the SPA's AccessIdTokenPathPage. The SPA does NOT have the raw
 *       id_token (token custody — it lives only on the BFF), so it falls back to
 *       req.session.oauthTokens.idToken.
 *
 * id_token resolution order (both verbs share this handler):
 *   1. req.body.params.idToken — primary, used by gateway POST
 *   2. req.session.oauthTokens.idToken — fallback, used by SPA GET
 *
 * Integrity check: when a body id_token is supplied, its `sub` claim MUST match
 * req.user.sub. Mismatch returns 412 id_token_subject_mismatch.
 *
 * Raw tokens never leave the BFF — only sanitizeClaims output is returned, with
 * scrubRawJwts as defense-in-depth.
 *
 * Per CLAUDE.md token custody. Per CONTEXT.md R2 §Path B: claims only, no banking data.
 * authenticateToken middleware (server.js:846) gates both verbs — missing/invalid bearer → 401.
 */
function respondWithIdentity(req, res) {
  // express.json() is globally mounted at server.js, so req.body is already parsed.
  const accessToken = req.session && req.session.oauthTokens && req.session.oauthTokens.accessToken
    ? req.session.oauthTokens.accessToken
    : null;

  // Primary: wire-forwarded id_token (gateway POST body); Fallback: session (SPA GET).
  const bodyIdToken    = req.body && req.body.params && req.body.params.idToken
    ? req.body.params.idToken
    : null;
  const sessionIdToken = req.session && req.session.oauthTokens && req.session.oauthTokens.idToken
    ? req.session.oauthTokens.idToken
    : null;
  const idToken = bodyIdToken || sessionIdToken;

  if (!idToken) {
    return res.status(412).json({
      error: 'id_token_missing',
      message: 'No id_token in request body or session. Sign in again with openid scope.',
    });
  }

  // Integrity check — only meaningful when a body id_token is supplied (gateway POST path).
  // For session-sourced id_tokens, the session itself is the binding to req.user.
  const idDecoded  = decodeJwtClaims(idToken) || {};
  const idSub      = idDecoded.claims && idDecoded.claims.sub;
  const userSub    = (req.user && req.user.sub) || (req.session && req.session.user && req.session.user.sub);
  if (bodyIdToken && idSub && userSub && idSub !== userSub) {
    return res.status(412).json({
      error: 'id_token_subject_mismatch',
      message: 'id_token subject does not match the authenticated bearer subject.',
    });
  }

  const accessDecoded = decodeJwtClaims(accessToken) || {};
  const accessClaims  = sanitizeClaims(accessDecoded.claims) || {};
  const idTokenClaims = sanitizeClaims(idDecoded.claims)     || {};

  // Audit trail per draft-ietf-oauth-identity-chaining (identity-chain pattern).
  // Log the act chain so compliance review can verify the delegation.
  // INTROSPECTION category (Phase 235) reused for the post-validation log entry.
  // G2 PII guard: log only non-PII fields (sub, aud, act, may_act) — NOT name/email/etc.
  try {
    const appEventService = require('../services/appEventService');
    appEventService.logEvent('INTROSPECTION', 'info', 'identity_call', {
      metadata: {
        sub: accessDecoded.claims && accessDecoded.claims.sub,
        aud: accessDecoded.claims && accessDecoded.claims.aud,
        act: (accessDecoded.claims && accessDecoded.claims.act)     || null,
        may_act: (accessDecoded.claims && accessDecoded.claims.may_act) || null,
        idTokenSource: bodyIdToken ? 'wire' : 'session',
        route: '/api/resource-server/identity',
      },
    });
  } catch (logErr) {
    // Logging MUST NOT break the response — swallow and continue.
    console.warn('[identity] audit log emit failed:', logErr.message);
  }

  const body = {
    credentialPath: 'dual_token',
    badge: 'ACCESS + ID-TOKEN PATH',
    color: 'teal',
    accessTokenClaims: accessClaims,
    idTokenClaims: idTokenClaims,
    idTokenSource: bodyIdToken ? 'wire' : 'session',
    message: 'banking_resource_server decoded your access token and id_token server-side. CLAIMS ONLY — no raw JWT crosses this boundary.',
    returnTo: '/dashboard',
    returnLabel: 'Back to Dashboard',
  };
  return res.json(scrubRawJwts(body));
}

// Both verbs bind to the same handler — gateway POSTs with body, SPA GETs from session.
router.get('/identity',  respondWithIdentity);
router.post('/identity', respondWithIdentity);

/**
 * GET /api/resource-server/accounts
 * Phase 266 R2 Path C endpoint. SQLite-backed via bankingDb.
 *
 * Returns the user's accounts in the SAME shape as the `accounts` field of /summary,
 * so a future migration of ResourceServerPage onto this route is drop-in.
 *
 * authenticateToken middleware (server.js:846) gates this route — missing/invalid bearer → 401.
 */
router.get('/accounts', (req, res) => {
  try {
    const userId = (req.user && req.user.sub) ||
      (req.session && req.session.user && (req.session.user.id || req.session.user.sub));
    if (!userId) return res.status(401).json({ error: 'authentication_required' });
    const accounts = bankingDb.getAccountsByUserId(userId);
    const formatted = accounts.map((a) => ({
      id: a.id,
      accountType: a.accountType,
      name: a.name,
      balance: a.balance,
      currency: a.currency || 'USD',
      status: a.status || 'active',
      accountNumber: a.accountNumber,
    }));
    return res.json(scrubRawJwts({ accounts: formatted }));
  } catch (err) {
    console.error('[resource-server] /accounts error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * GET /api/resource-server/transactions
 * Phase 266 R2 Path C endpoint. SQLite-backed via bankingDb.
 *
 * Supports ?limit=N query param (default falls back to bankingDb DEFAULT_TX_LIMIT — 50).
 * Returns the user's transactions in the SAME shape as the `transactions` field of /summary.
 */
router.get('/transactions', (req, res) => {
  try {
    const userId = (req.user && req.user.sub) ||
      (req.session && req.session.user && (req.session.user.id || req.session.user.sub));
    if (!userId) return res.status(401).json({ error: 'authentication_required' });
    const limitRaw = parseInt(req.query && req.query.limit, 10);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined;
    const txs = bankingDb.getTransactionsByUserId(userId, limit);
    const formatted = txs.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      description: t.description || t.type,
      createdAt: t.createdAt,
    }));
    return res.json(scrubRawJwts({ transactions: formatted }));
  } catch (err) {
    console.error('[resource-server] /transactions error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * GET /api/resource-server/vertical-record?tool=show_mortgage
 * Returns the vertical-specific record from demo_api_resource_server's feature data.
 */
router.get('/vertical-record', (req, res) => {
  const toolName = req.query.tool;
  if (!toolName) return res.status(400).json({ error: 'missing_tool_param' });

  const TOOL_TO_RECORD_KEY = {
    show_mortgage: 'mortgage',
    show_health_record: 'healthRecord',
    show_investment: 'invest',
    show_gear_order: 'gearOrder',
    show_gear_warranty: 'gearWarranty',
    show_expense_report: 'expenseReport',
    show_permit: 'permit',
    show_enrollment: 'enrollment',
    show_work_order: 'workOrder',
    show_large_purchase: 'largePurchase',
  };

  const recordKey = TOOL_TO_RECORD_KEY[toolName];
  if (!recordKey) return res.json({ tool: toolName, note: 'No vertical record mapping' });

  try {
    const featureData = require('../../demo_api_resource_server/feature-records.generated.json');
    const entry = featureData[recordKey];
    if (!entry) return res.json({ tool: toolName, note: `No record for key: ${recordKey}` });
    return res.json({ vertical: recordKey, noun: entry.noun, ...entry.record });
  } catch (err) {
    return res.json({ tool: toolName, note: 'Feature data not available' });
  }
});

module.exports = router;

