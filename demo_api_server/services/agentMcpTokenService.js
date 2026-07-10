// banking_api_server/services/agentMcpTokenService.js
/**
 * Resolves the access token sent to banking_mcp_server: either legacy (user-only exchange)
 * or on-behalf-of (subject = user, actor = agent OAuth client) when USE_AGENT_ACTOR_FOR_MCP=true.
 *
 * **Token names** (used in tokenEvents labels and documentation):
 * - **User access token** — PingOne OAuth access token for the end user; held in the BFF session; RFC 8693 `subject_token`.
 * - **Agent access token** — Client-credentials token for `AGENT_OAUTH_CLIENT_ID`; optional RFC 8693 `actor_token`.
 * - **MCP access token** — Delegated access token PingOne issues for the MCP audience (`mcp_resource_uri`); Bearer to MCP.
 *
 * Also returns tokenEvents — decoded token metadata for the UI Token Chain panel.
 * No raw tokens are included. Each event may include jwtFullDecode: { header, claims }
 * (full JWT payload JSON for dumps) alongside a smaller sanitized `claims` field for tables.
 */
'use strict';

const { logger, LOG_CATEGORIES } = require('../utils/logger');
const _CAT = LOG_CATEGORIES.MCP_TOKEN_SERVICE;

const DEBUG = process.env.DEBUG_AGENT_MCP === 'true';
function debugLog(...args) {
  if (DEBUG) {
    logger.debug(_CAT, args.join(' '));
  }
}

function errorLog(...args) {
  logger.error(_CAT, args.join(' '));
}

function warnLog(...args) {
  logger.warn(_CAT, args.join(' '));
}

const configStore = require('./configStore');
const oauthService = require('./oauthService');
const clientAssertionService = require('./clientAssertionService');
const { writeExchangeEvent } = require('./exchangeAuditStore');
const { createTokenExchangeError, RFC8693_ERRORS } = require('./rfcCompliantErrorHandler');
// Architecture-note R1 (2026-05-15) / T-2: the BFF no longer makes a local
// authorization DECISION about whether a tool call is permitted. PingAuthorize
// (`mcpToolAuthorizationService.evaluateMcpFirstToolGate`, server.js — runs
// unconditionally on every MCP tool call after token resolution) is the SOLE
// authoritative tool-call gate. The former local `agentMcpScopePolicy` scope-
// allow-list veto was a redundant second authz layer and has been deleted; do
// not reintroduce a local scope-permit decision here.
const { MCP_TOOL_SCOPES, getSessionBearerForMcp } = require('./mcpWebSocketClient');
const { writeMcpTrafficEntry } = require('./mcpTrafficLogger');
const { trackTokenEvent } = require('./tokenChainService');
const { trackToken } = require('./apiCallTrackerService');
const { logEvent: logAppEvent } = require('./appEventService');
const { decodeJwt, sanitizePingOneResponse } = require('../utils/tokenUtils');
const tokenExchangeConfig = require('../config/tokenExchangeConfig');
const tokenVerificationService = require('./tokenVerificationService');
const oauthConfig = require('../config/oauth');
const { validateToken: jwksValidateUserToken } = require('./tokenValidationService');
const { getSessionDpopKey } = require('./dpopKeyService');
const scopeTopology = require('./scopeTopology');
const enterpriseMcpPolicy = require('./enterpriseMcpPolicyService');
const { isEnterpriseManagedFlagOn } = require('./enterpriseMcpMetadata');
const {
  resolveActiveUseCaseId,
  shouldSimulateRetiredAgentExchange,
  buildJitExchangeOptions,
  stampTokenEventsForUseCase,
  buildEventMetadata,
  JIT_TOKEN_LIFETIME_SEC,
  JIT_EPHEMERAL,
} = require('./useCaseDemoBehaviors');

/** Read a boolean feature flag from configStore (accepts true | 'true'). */
function _flagOn(key) {
  const v = configStore.getEffective(key);
  return v === true || v === 'true';
}

/**
 * Build RFC 9396 authorization_details from the tool name + parameters. Intent-bound,
 * constraint-based authorization: the agent is authorized for THIS specific action
 * (action/amount/payee), not a broad scope. Returns a single-element array (the RAR
 * shape) or null when there is nothing to bind.
 */
function buildRarAuthorizationDetails(tool, params, userSub) {
  if (!tool) return null;
  const p = params && typeof params === 'object' ? params : {};
  const detail = { type: 'banking_transaction', tool, actions: [tool] };
  const amount = p.amount ?? p.value ?? p.transferAmount;
  if (amount !== undefined && amount !== null && amount !== '') {
    const n = Number(amount);
    if (!Number.isNaN(n)) detail.amount = n;
  }
  if (p.currency) detail.currency = p.currency;
  // Canonical MCP tool params are snake_case: to_account_id and from_account_id. Keep
  // camelCase fallbacks for other callers. Must match what the gateway enforces against.
  const payee = p.to_account_id ?? p.payee ?? p.toAccountId ?? p.toAccount ?? p.to;
  if (payee) detail.payee = String(payee);
  const from = p.from_account_id ?? p.from ?? p.fromAccountId ?? p.fromAccount ?? p.account;
  if (from) detail.from = String(from);
  if (userSub) detail.sub = userSub;
  return [detail];
}

/**
 * Compute the RAR (RFC 9396) + DPoP (RFC 9449) extras to fold into the TraT envelope,
 * and emit the matching Token Chain events. Returns { ffDpop, ffRar, extras } where
 * extras = { rarDetails, cnfJkt } (either may be undefined). Shared by both the
 * single-exchange and two-exchange paths so they stay in sync.
 */
function _buildAgenticExtras(req, tool, userSub, tokenEvents) {
  const ffDpop = _flagOn('ff_dpop');
  const ffRar = _flagOn('ff_rar');
  const extras = {};
  if (ffRar) {
    const rarDetails = buildRarAuthorizationDetails(tool, req?.body?.params, userSub);
    if (rarDetails) {
      extras.rarDetails = rarDetails;
      if (Array.isArray(tokenEvents)) {
        tokenEvents.push(buildTokenEvent(
          'rar-authorization',
          'Rich Authorization Request (RAR) — Intent-bound',
          'active',
          null,
          'ff_rar is ON. The BFF built authorization_details from the tool + parameters and carries them in the ' +
            'TraT azd envelope + the PingAuthorize decision context. The agent is authorized for THIS specific action, ' +
            'not a broad scope. Simulated on PingOne SaaS; native on AIC / PingFederate 11.2+.',
          { rfc: 'RFC 9396', authorization_details: rarDetails }
        ));
      }
    }
  }
  if (ffDpop) {
    const key = getSessionDpopKey(req);
    if (key?.jkt) {
      extras.cnfJkt = key.jkt;
      if (Array.isArray(tokenEvents)) {
        tokenEvents.push(buildTokenEvent(
          'dpop-binding',
          'DPoP — Sender-constrained token (cnf.jkt)',
          'active',
          null,
          'ff_dpop is ON. The delegated MCP token is bound to a per-session ephemeral key (cnf.jkt). ' +
            'A signed DPoP proof is sent on each hop and verified at the gateway and MCP server, so a stolen ' +
            'bearer is useless without the private key. Thumbprint carried via the TraT envelope (simulated); ' +
            'native cnf claim on AIC / PingFederate 11.2+.',
          { rfc: 'RFC 9449', cnf: { jkt: key.jkt } }
        ));
      }
    }
  }
  return { ffDpop, ffRar, extras };
}

/**
 * Active-token check for the USER's own token, by JWKS signature + expiry on the
 * REAL token — NOT RFC 7662 introspection authenticated with the Worker client.
 * PingOne's introspection endpoint rejects the Worker client for this purpose
 * (401), and introspecting another client's token is the wrong model here: the
 * user token is a verifiable JWT, so validate it directly (same as the BFF's
 * authenticateToken middleware does for /api/* routes).
 *
 * Contract mirrors tokenIntrospectionService.validateToken so the caller is
 * unchanged: returns { valid, sub, scopes, exp, aud, client_id } — valid:false
 * for an expired/invalid token (caller then tries silent refresh), and THROWS
 * only on infrastructure errors (JWKS fetch failure) so the caller treats it as
 * "skipped" rather than blocking the exchange.
 */
async function jwksActiveCheckUserToken(token) {
  try {
    const payload = await jwksValidateUserToken(token, { jwksUri: oauthConfig.jwksEndpoint });
    const scopeStr = typeof payload.scope === 'string'
      ? payload.scope
      : (Array.isArray(payload.scope) ? payload.scope.join(' ') : '');
    return {
      valid: true,
      sub: payload.sub,
      exp: payload.exp,
      aud: Array.isArray(payload.aud) ? payload.aud.join(' ') : payload.aud,
      client_id: payload.client_id,
      scopes: scopeStr,
    };
  } catch (err) {
    // Token genuinely invalid/expired → not active (caller tries refresh).
    if (['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError'].includes(err.name)) {
      return { valid: false };
    }
    // JWKS fetch / config error → infrastructure, not a token verdict. Re-throw so
    // the caller's catch records "skipped" and proceeds (matches prior behavior).
    throw err;
  }
}

/** Minimum distinct scopes on the User access token before RFC 8693 to MCP (so PingOne can narrow audience + scope). */
const MIN_USER_SCOPES_FOR_MCP = Math.max(
  1,
  parseInt(process.env.MIN_USER_SCOPES_FOR_MCP_EXCHANGE || '1', 10) || 1
);

/**
 * Count space-separated OAuth scopes on JWT claims (PingOne access tokens).
 * @param {object|null|undefined} claims
 * @returns {number}
 */
function countJwtScopes(claims) {
  if (!claims || claims.scope == null) return 0;
  const s = String(claims.scope).trim();
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Attach tokenEvents for the UI and throw with HTTP status + machine code.
 * @param {Array} tokenEvents
 * @param {string} code
 * @param {string} message
 * @param {number} [httpStatus]
 */
function throwTokenResolutionError(tokenEvents, code, message, httpStatus = 502) {
  const err = new Error(`[agentMcpTokenService] ${message}`);
  err.code = code;
  err.source = 'agentMcpTokenService';
  err.tokenEvents = tokenEvents;
  err.httpStatus = httpStatus;
  throw err;
}

// ─── JWT decode (no verification — display only) ─────────────────────────────

/**
 * Decode a JWT without signature verification.
 * Returns { header, claims } or null if malformed.
 * NEVER returns the raw token string.
 */
function decodeJwtClaims(token) {
  return decodeJwt(token);
}

/**
 * Build a sanitized claims snapshot for the UI.
 * Strips any field that could be sensitive or identifying beyond what's needed for education.
 */
function sanitizeClaims(claims) {
  if (!claims) { return null; }
  const result = {};
  if (claims.sub)    result.sub    = claims.sub;
  if (claims.aud)    result.aud    = claims.aud;
  if (claims.scope)  result.scope  = claims.scope;
  if (claims.iss)    result.iss    = claims.iss;
  if (claims.exp)    result.exp    = claims.exp;
  if (claims.iat)    result.iat    = claims.iat;
  if (claims.nbf)    result.nbf    = claims.nbf;
  if (claims.may_act) result.may_act = claims.may_act;
  if (claims.act)    result.act    = claims.act;
  if (claims.client_id) result.client_id = claims.client_id;
  if (claims.azp)    result.azp    = claims.azp;
  if (claims.jti)    result.jti    = claims.jti;
  if (claims.email) result.email = claims.email;
  if (claims.name) result.name = claims.name;
  if (claims.preferred_username) result.preferred_username = claims.preferred_username;
  if (claims.given_name) result.given_name = claims.given_name;
  if (claims.family_name) result.family_name = claims.family_name;
  if (claims.acr) result.acr = claims.acr;
  if (claims.auth_time) result.auth_time = claims.auth_time;
  if (claims.sid) result.sid = claims.sid;
  // Intent token claims (BFF-minted, non-PII)
  if (claims.intent) result.intent = claims.intent;
  if (claims.confidence !== undefined) result.confidence = claims.confidence;
  if (claims.permitted_tools) result.permitted_tools = claims.permitted_tools;
  if (claims.prompt_hash) result.prompt_hash = claims.prompt_hash;
  if (claims.vertical) result.vertical = claims.vertical;
  return result;
}

/**
 * Build a token event object for the frontend Token Chain panel.
 * @param {string}  id
 * @param {string}  label
 * @param {string}  status  Token-chain status vocabulary. The SPA's
 *   NarrativePanel.dotClass (banking_api_ui/src/components/NarrativePanel.js)
 *   only styles a subset — 'success'/'acquired' (green), 'error' (red),
 *   'active'/'pending' (amber) — and silently buckets any other value to the
 *   default dot. The event SHAPE { id,label,status,timestamp,claims,
 *   explanation,... } is the stable contract the SPA depends on; the status
 *   STRING is presentation-only and intentionally NOT normalized to avoid
 *   changing observable UI styling. Full set actually emitted across call
 *   sites (kept here as the single source of truth so this doc cannot drift):
 *   'active' | 'acquiring' | 'exchanged' | 'waiting' | 'success' | 'failed' |
 *   'skipped' | 'warning' | 'degraded' | 'permit' | 'deny' | 'indeterminate'
 * @param {object|null} decoded  { header, claims } from decodeJwtClaims
 * @param {string}  explanation  Human-readable description of what happened and why
 * @param {object}  [extra]  Extra fields (exchangeDetails, error, rfc, etc.)
 */
function buildTokenEvent(id, label, status, decoded, explanation, extra = {}) {
  /** Full JWT decode (header + sanitized payload) for Token Chain JSON dump — never
   *  includes the raw token string. claims run through the same sanitizeClaims
   *  whitelist as the `claims` field above so an unexpected PII/credential claim
   *  embedded in a token cannot surface verbatim in the JSON dump. */
  const jwtFullDecode =
    decoded?.claims != null
      ? { header: decoded.header ?? null, claims: sanitizeClaims(decoded.claims) }
      : null;
  return {
    id,
    label,
    status,
    timestamp: new Date().toISOString(),
    alg: decoded?.header?.alg || null,
    claims: sanitizeClaims(decoded?.claims),
    explanation,
    ...extra,
    ...(jwtFullDecode ? { jwtFullDecode } : {}),
  };
}

/**
 * Build the 'token-refresh' chain card shown after a silent RFC 6749 §6 refresh.
 * Shared by the session-preview (idle) surface and the live tool-call chain so
 * both render an identical card. `accessToken` is the NEWLY minted access token.
 */
function buildRefreshTokenEvent(accessToken, refreshedAt) {
  const decoded = decodeJwtClaims(accessToken);
  return buildTokenEvent(
    'token-refresh',
    'Refreshed Access Token (RFC 6749 §6)',
    'active',
    decoded,
    'A new access token was silently minted from the refresh token (RFC 6749 §6). '
      + 'Same sub; the refresh token rotates and exp is extended. Tokens never reach the browser.',
    { rfc: 'RFC 6749', refreshedAt: refreshedAt || null },
  );
}

/**
 * Prepend a 'token-refresh' card to a live tool-call chain when the access token
 * was refreshed during this request (req._didRefresh, set by middleware/tokenRefresh).
 * Guarded: no-ops if no refresh happened, and skips if a 'token-refresh' card is
 * already present (e.g. when the session-preview fallback already added it).
 */
function prependRefreshEvent(req, events) {
  const list = Array.isArray(events) ? events : [];
  if (!req?._didRefresh) return list;
  if (list.some((e) => e?.id === 'token-refresh')) return list;
  const at = req.session?.oauthTokens?.accessToken;
  if (!at) return list;
  return [buildRefreshTokenEvent(at, req.session?.oauthTokens?.refreshedAt), ...list];
}

function buildTratContext(req, tool, userSub, agentClientId, gatewayClientId, extras = {}) {
  const correlationId = req?.headers?.['x-correlation-id'] || req?.session?.correlationId || null;
  const vertical = req?.body?.vertical || req?.session?.activeVertical || 'banking';
  const ctx = {
    reqctx: {
      tool: tool || '',
      session_id: req?.sessionID || '',
      correlation_id: correlationId || '',
    },
    purp: `${vertical}:mcp:tool_call`,
    azd: {
      sub: userSub || '',
      act: agentClientId || '',
      gateway: gatewayClientId || '',
    },
    rctx: {
      ip: req?.ip || req?.socket?.remoteAddress || '',
      user_agent: 'banking-bff/1.0',
      timestamp: new Date().toISOString(),
    },
  };
  // RFC 9396 RAR: carry authorization_details inside azd (the trusted TraT envelope).
  if (extras.rarDetails) ctx.azd.authorization_details = extras.rarDetails;
  // RFC 9449 DPoP: carry the key thumbprint so the gateway/MCP can bind+verify the proof
  // in simulated mode (PingOne SaaS does not yet issue cnf in the exchanged token).
  if (extras.cnfJkt) ctx.cnf = { jkt: extras.cnfJkt };
  return ctx;
}

// ─── may_act validation (informational — PingOne does the real check) ─────────

/**
 * Inspect the subject token's may_act claim and return a human-readable result.
 * This mirrors the validation algorithm in may_act.md §Reference Validation Algorithm.
 * The actual enforcement is performed by PingOne during the token exchange; this
 * function produces the explanation text shown in the UI.
 */
function describeMayAct(claims, bffClientId) {
  if (!claims) return { valid: false, reason: 'no claims decoded' };
  const { may_act } = claims;

  if (!may_act) {
    return {
      valid: false,
      reason: 'may_act claim absent — PingOne may reject the exchange; add the may_act claim via a PingOne token policy to guarantee acceptance',
    };
  }
  if (typeof may_act !== 'object' || Array.isArray(may_act)) {
    return { valid: false, reason: 'may_act is not a JSON object — invalid per RFC 8693 / may_act spec' };
  }

  const checks = [];
  let mismatch = false;

  if (may_act.client_id) {
    const match = !bffClientId || may_act.client_id === bffClientId;
    const mismatchMsg = match ? '✅ matches Backend-for-Frontend (BFF)' : `❌ mismatch (Backend-for-Frontend (BFF) is ${bffClientId})`;
    checks.push(`client_id: ${may_act.client_id} ${mismatchMsg}`);
    if (!match) mismatch = true;
  }
  if (may_act.sub) {
    checks.push(`sub: ${may_act.sub}`);
  }
  if (may_act.iss) {
    checks.push(`iss: ${may_act.iss}`);
  }

  if (checks.length === 0) {
    return { valid: false, reason: 'may_act has no recognised fields (client_id / sub / iss)' };
  }

  return {
    valid: !mismatch,
    reason: checks.join(' · '),
    mayActObj: may_act,
  };
}

/**
 * Append the user access token row to tokenEvents (same shape as MCP tool-call flow).
 * @returns {{ userSub: string|null, userAccessTokenClaims: object|undefined, userAccessTokenDecoded: object|null }}
 */

/**
 * Run JWKS signature verification on `token` and push the result event.
 * Shared by all token types that need RFC 7515 verification.
 * Fail-open — never throws or blocks the token flow.
 *
 * @param {string}   token       Raw JWT to verify
 * @param {Array}    tokenEvents Mutable event array to push into
 * @param {string}   eventId     Token-event id for the verify row (e.g. 'agent-actor-token-verified')
 * @param {string}   tokenLabel  Human label shown in the UI (e.g. 'Agent Actor Token')
 */
async function pushJwksVerifyEvent(token, tokenEvents, eventId, tokenLabel) {
  try {
    const verif = await tokenVerificationService.verifyExchangedToken(token);
    const isIntrospectionFallback = verif.fallbackMethod === 'introspection';
    const methodLabel = isIntrospectionFallback
      ? `${tokenLabel} — Introspection Fallback (RFC 7662) · JWKS Unavailable`
      : `${tokenLabel} — JWKS Cryptographic Signature Verification (RFC 7515)`;
    let explanation;
    if (verif.verified && !isIntrospectionFallback) {
      explanation = `Signature verified ✅ — PingOne's public key (kid=${verif.kid}, alg=${verif.alg}) confirms this token is authentic and untampered since issuance. RFC 7515 §4.`;
    } else if (verif.verified && isIntrospectionFallback) {
      explanation = `JWKS unavailable — fell back to RFC 7662 introspection ✅. PingOne confirmed the token is active. Cryptographic tamper-detection was skipped; acceptable here because the token was received directly from PingOne.`;
    } else if (verif.warning) {
      explanation = `Signature check produced a warning (fail-open): ${verif.warning}.`;
    } else {
      explanation = `Verification FAILED ❌ — ${verif.error || 'Unknown error'}. Token may have been tampered with or have expired.`;
    }
    tokenEvents.push(buildTokenEvent(
      eventId,
      methodLabel,
      verif.verified ? 'active' : (verif.warning ? 'warning' : 'failed'),
      verif.verified ? verif.claims : null,
      explanation,
      {
        rfc: isIntrospectionFallback ? 'RFC 7662 (fallback) · RFC 7515 attempted' : 'RFC 7515 · RFC 7517 · RFC 7518',
        verified: verif.verified,
        fallbackMethod: verif.fallbackMethod,
        alg: verif.alg,
        kid: verif.kid,
        warning: verif.warning,
        error: verif.error,
      }
    ));
  } catch (verifErr) {
    tokenEvents.push(buildTokenEvent(
      eventId,
      `${tokenLabel} — JWKS Verification (RFC 7515)`,
      'skipped',
      null,
      `JWKS verification skipped: ${verifErr.message}`,
      { rfc: 'RFC 7515 · RFC 7517' }
    ));
  }
}

function appendUserTokenEvent(tokenEvents, userToken, req = null) {
  const userAccessTokenDecoded = decodeJwtClaims(userToken);
  const userAccessTokenClaims = userAccessTokenDecoded?.claims;
  const userSub = userAccessTokenClaims?.sub != null ? String(userAccessTokenClaims.sub) : null;
  const bffClientId = configStore.getEffective('user_client_id') || process.env.PINGONE_CLIENT_ID || null;
  const mayActInfo = describeMayAct(userAccessTokenClaims, bffClientId);

  // Scope: prefer JWT claim, fall back to scope stored in session (PingOne may omit it from JWT)
  const jwtScope = userAccessTokenClaims?.scope;
  const sessionScope = req?.session?.oauthTokens?.scope;
  const effectiveScopeStr = jwtScope || sessionScope || '';
  const scopeSource = jwtScope ? 'jwt' : sessionScope ? 'session' : 'none';

  const tokenScopes = effectiveScopeStr
    ? String(effectiveScopeStr).split(/\s+/).filter(Boolean)
    : [];
  const hasAgentScope = tokenScopes.some(s => s.includes('agent'));
  const agentScopesInToken = tokenScopes.filter(s => s.includes('agent'));

  let scopeDetails;
  if (tokenScopes.length > 0) {
    scopeDetails = `Token carries ${tokenScopes.length} scope(s): ${tokenScopes.join(' ')}` +
      (scopeSource === 'session' ? ' (from OAuth token_response — not embedded in JWT)' : '') +
      (hasAgentScope ? `\n✓ Agent scopes: ${agentScopesInToken.join(', ')}` : `\n⚠️ NO agent scopes found`);
    // Patch scope back onto the decoded claims so the UI ScopesBadges renders them
    if (scopeSource === 'session' && userAccessTokenDecoded?.claims) {
      userAccessTokenDecoded.claims.scope = effectiveScopeStr;
    }
  } else {
    scopeDetails = '⚠️ No scope claim in JWT and no scope in token response. ' +
      'Configure the PingOne customer app to include read and write scopes.';
  }

  tokenEvents.push(buildTokenEvent(
    'user-token',
    'User access token',
    'active',
    userAccessTokenDecoded,
    'Issued by PingOne after Authorization Code + PKCE login. ' +
    'Stored in the Backend-for-Frontend (BFF) session (server-side httpOnly cookie — never sent to the browser). ' +
    scopeDetails,
    {
      rfc: 'RFC 7519 (JWT) · RFC 9068 (OAuth2 JWT AT)',
      tokenScopes,
      scopeCount: tokenScopes.length,
      hasAgentScope,
      agentScopesInToken,
      mayActPresent: !!userAccessTokenClaims?.may_act,
      mayActValid: mayActInfo.valid,
      mayActDetails: mayActInfo.reason,
    }
  ));

  return { userSub, userAccessTokenClaims, userAccessTokenDecoded };
}

/**
 * Append login-time ID token (OIDC) and refresh token (RFC 6749) cards to the
 * session-preview chain. Both are issued by PingOne alongside the access token
 * and held server-side in the BFF session — they never reach the browser.
 *
 *  - ID token: a signed JWT (OpenID Connect Core §2). Decoded so the audience can
 *    see the identity claims (sub, aud=client_id, iss, exp, auth_time, acr, …).
 *  - Refresh token: an OPAQUE credential (RFC 6749 §1.5), not a JWT — there are
 *    no claims to decode. We surface only its presence; the value is never read
 *    into the event (it is a long-lived bearer secret).
 *
 * Each card is conditional: PingOne returns id_token only when the `openid` scope
 * was granted, and refresh_token only when `offline_access` was granted.
 */
function appendLoginIdAndRefreshTokenEvents(tokenEvents, req) {
  const oauthTokens = req?.session?.oauthTokens || {};

  const idToken = oauthTokens.idToken;
  if (idToken && typeof idToken === 'string') {
    const idDecoded = decodeJwtClaims(idToken);
    if (idDecoded?.claims) {
      tokenEvents.push(buildTokenEvent(
        'id-token',
        'ID token (OpenID Connect)',
        'active',
        idDecoded,
        'Issued by PingOne at login when the openid scope is granted. Proves the user\'s identity to the '
          + 'BFF (the relying party): aud is the BFF client_id, and claims like auth_time and acr describe '
          + 'how and when the user authenticated. Held in the BFF session and used for OIDC sign-off — it is '
          + 'NOT a bearer for API calls (that is the access token above) and never reaches the browser.',
        { rfc: 'OpenID Connect Core 1.0 §2 · RFC 7519 (JWT)' }
      ));
    }
  }

  // Opaque refresh token — the '_cookie_session' sentinel marks a cookie-only
  // restored session that carries no real refresh token.
  const refreshToken = oauthTokens.refreshToken;
  if (refreshToken && typeof refreshToken === 'string' && refreshToken !== '_cookie_session') {
    tokenEvents.push(buildTokenEvent(
      'refresh-token',
      'Refresh token (RFC 6749 §1.5)',
      'active',
      null,
      'Issued by PingOne at login when the offline_access scope is granted. An OPAQUE credential '
        + '(not a JWT — no claims to decode) used to silently mint new access tokens when the current one '
        + 'expires (RFC 6749 §6). Held server-side in the BFF session and never sent to the browser; the '
        + 'token value is intentionally not shown here.',
      { rfc: 'RFC 6749 §1.5 · §6', opaque: true }
    ));
  }
}

/**
 * Session-only token chain rows for the dashboard after login — decodes User Token from BFF session only (no PingOne exchange).
 * @param {import('express').Request} req
 * @returns {{ tokenEvents: Array }}
 */
async function buildSessionPreviewTokenEvents(req) {
  const tokenEvents = [];
  const userToken = getSessionBearerForMcp(req);
  if (!userToken) {
    return { tokenEvents: [] };
  }

  appendUserTokenEvent(tokenEvents, userToken, req);

  // ── ID token + refresh token issued at login ────────────────────────────────
  // PingOne returns these alongside the access token (when openid / offline_access
  // are granted). Surface them right under the access token so the chain shows the
  // full set of credentials the user received at authentication.
  appendLoginIdAndRefreshTokenEvents(tokenEvents, req);

  // ── Silent token refresh (RFC 6749 §6) ──────────────────────────────────────
  // If the access token was refreshed (marker stamped by middleware/tokenRefresh),
  // show a 'token-refresh' card right under the user token. `userToken` is already
  // the refreshed access token, so its claims carry the new exp/scope.
  if (req.session?.oauthTokens?.refreshedAt) {
    tokenEvents.push(buildRefreshTokenEvent(userToken, req.session.oauthTokens.refreshedAt));
  }

  // ── PingOne Introspection at Login (RFC 7662) ───────────────────────────────
  // If introspection was run at login time, show those results in the chain.
  // loginIntrospection is stored in the session by the OAuth callback handler.
  const loginIntro = req.session && req.session.loginIntrospection;
  if (loginIntro) {
    const introStatus = loginIntro.active ? 'active' : 'failed';
    tokenEvents.push(buildTokenEvent(
      'user-token-introspection',
      'User Token — PingOne Active-Token Introspection at Login (RFC 7662)',
      introStatus,
      loginIntro.active
        ? {
            header: null,
            claims: {
              sub:       loginIntro.sub,
              active:    true,
              scope:     Array.isArray(loginIntro.scopes) ? loginIntro.scopes.join(' ') : (loginIntro.scopes || null),
              exp:       loginIntro.exp,
              aud:       loginIntro.aud,
              client_id: loginIntro.client_id,
            },
          }
        : null,
      loginIntro.active
        ? `PingOne confirmed the user token is active at login. sub=${loginIntro.sub} scope="${loginIntro.scopes || ''}". Introspection is called once per login and cached in the session.`
        : `PingOne returned active=false at login — the token was already inactive when the session was established.`,
      {
        rfc: 'RFC 7662',
        introspectionResult: {
          active:    loginIntro.active,
          sub:       loginIntro.sub,
          exp:       loginIntro.exp,
          aud:       loginIntro.aud,
          scope:     loginIntro.scopes,
          client_id: loginIntro.client_id,
        },
      }
    ));
  }

  const mcpResourceUri = configStore.getEffective('pingone_resource_mcp_server_uri');
  if (!mcpResourceUri) {
    tokenEvents.push(buildTokenEvent(
      'exchange-required',
      'Token Exchange (RFC 8693) — Not Configured',
      'skipped',
      null,
      'mcp_resource_uri is not set — RFC 8693 token exchange is not active. ' +
        'Banking tools run via local fallback; the user access token is never forwarded to MCP. ' +
        'Token exchange (and human-in-the-loop consent) applies to high-value and transfer transactions.',
      { rfc: 'RFC 8693 · RFC 8707' }
    ));
    return { tokenEvents };
  }

  const userAccessTokenDecoded = decodeJwtClaims(userToken);
  const userAccessTokenClaims = userAccessTokenDecoded?.claims;
  const scopeCount = countJwtScopes(userAccessTokenClaims);
  if (scopeCount < MIN_USER_SCOPES_FOR_MCP) {
    tokenEvents.push(buildTokenEvent(
      'user-scopes-insufficient',
      'User access token — insufficient scopes for MCP exchange',
      'failed',
      userAccessTokenDecoded,
      `User access token has ${scopeCount} scope(s); at least ${MIN_USER_SCOPES_FOR_MCP} distinct scopes are required ` +
        'so PingOne can issue a delegated MCP token with a narrower audience and reduced scopes. ' +
        'Request additional scopes at login (PingOne app) and sign in again.',
      { rfc: 'RFC 8693', scopeCount, minRequired: MIN_USER_SCOPES_FOR_MCP }
    ));
    return { tokenEvents };
  }

  tokenEvents.push(buildTokenEvent(
    'exchange',
    'Token exchange (RFC 8693): user access token → MCP access token',
    'waiting',
    null,
    'Your session has a user access token (above). The exchange runs when the AI Agent invokes a banking tool. ' +
      'For high-value and transfer transactions, the exchange is paired with human-in-the-loop consent (HITL).',
    { rfc: 'RFC 8693 · RFC 8707' }
  ));

  tokenEvents.push(buildTokenEvent(
    'exchanged-token',
    'MCP access token (delegated) → MCP server',
    'waiting',
    null,
    'After a successful exchange on an MCP tool call, decoded MCP access token claims (including act, audience, and scope) appear here.',
    { rfc: 'RFC 8693' }
  ));

  return { tokenEvents };
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the MCP access token and produce tokenEvents for the UI Token Chain panel.
 *
 * Returns { token, tokenEvents, userSub } where:
 *   token       — the JWT to pass to the MCP server (may be exchanged)
 *   tokenEvents — array of TokenEvent objects for the frontend
 *   userSub     — PingOne subject from the User token, for MCP metadata
 *
 * @param {import('express').Request} req
 * @param {string} tool
 */

// ─── Dual-Mode Token Exchange (Phase 198) ──────────────────────────────────

/**
 * Generate a transaction ID for tracking transaction-tokens mode exchanges.
 * Format: txn-{uuid}
 */
function generateTransactionId() {
  const crypto = require('crypto');
  const uuid = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return `txn-${uuid}`;
}

/**
 * Perform RFC 8693 token exchange (original implementation).
 * This is the current production-stable exchange method.
 * 
 * @param {string} userToken - User access token from session
 * @param {string|null} actorToken - Optional agent actor token
 * @param {string} mcpResourceUri - Target audience for MCP token
 * @param {Array} finalScopes - Scopes to request in exchange
 * @returns {Promise<string|null>} - Exchanged MCP token or null on failure
 */
async function exchangeTokenRfc8693(userToken, actorToken, mcpResourceUri, finalScopes) {
  let exchangedToken = null;
  const _exchangeT0 = Date.now();
  writeMcpTrafficEntry({ dir: 'BFF→PingOne', type: 'exchange_request', method: 'token_exchange', tool: null, ok: true, summary: `RFC 8693 exchange → scopes: ${(finalScopes||[]).join(' ')} aud: ${mcpResourceUri||'(default)'}`, payload: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', audience: mcpResourceUri, scope: (finalScopes||[]).join(' '), has_actor_token: !!(actorToken) } });
  
  try {
    const exchangerClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
    const exchangerClientSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
    
    if (actorToken && exchangerClientId && exchangerClientSecret) {
      const exchangerAuthMethod = (
        process.env.PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD ||
        process.env.PINGONE_MCP_TOKEN_EXCHANGER_AUTH_METHOD ||
        'post'
      ).toLowerCase();
      exchangedToken = await oauthService.performTokenExchangeAs(
        userToken, actorToken, exchangerClientId, exchangerClientSecret, mcpResourceUri, finalScopes, exchangerAuthMethod
      );
    } else if (_flagOn('ff_private_key_jwt_token_exchange')) {
      // Use dedicated private_key_jwt app for token exchange when enabled
      exchangedToken = await oauthService.performTokenExchangeWithDedicatedApp(
        userToken, mcpResourceUri, finalScopes, actorToken || null
      );
    } else if (actorToken) {
      exchangedToken = await oauthService.performTokenExchangeWithActor(
        userToken, actorToken, mcpResourceUri, finalScopes
      );
    } else {
      exchangedToken = await oauthService.performTokenExchange(
        userToken, mcpResourceUri, finalScopes
      );
    }
  } catch (err) {
    errorLog('[RFC8693Exchange]', err.message);
    writeMcpTrafficEntry({ dir: 'PingOne→BFF', type: 'error', method: 'token_exchange', tool: null, durationMs: Date.now()-_exchangeT0, ok: false, summary: `RFC 8693 exchange ← ERROR: ${err.message}`, payload: { error: err.message, code: err.code } });
    logAppEvent('token_exchange', 'error', `RFC 8693 exchange failed: ${err.message}`,
      { tag: 'token_exchange/rfc8693-error', metadata: { mcpResourceUri, errorMessage: err.message, durationMs: Date.now()-_exchangeT0 } });
    return null;
  }

  writeMcpTrafficEntry({ dir: 'PingOne→BFF', type: 'exchange_response', method: 'token_exchange', tool: null, durationMs: Date.now()-_exchangeT0, ok: !!exchangedToken, summary: `RFC 8693 exchange ← ${exchangedToken?'OK token received':'FAILED no token'} (${Date.now()-_exchangeT0}ms)`, payload: { token_received: !!exchangedToken } });
  const _exchangedDecoded = decodeJwt(exchangedToken);
  const _rfc8693Request = {
    grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
    audience: mcpResourceUri,
    scope: (finalScopes || []).join(' '),
    hasActorToken: !!(actorToken),
  };
  const _rfc8693Response = sanitizePingOneResponse(_exchangedDecoded?.claims || {});
  logAppEvent('token_exchange', 'info', 'RFC 8693 token exchange success — MCP access token obtained',
    { tag: 'token_exchange/rfc8693-success', metadata: { mcpResourceUri, scopeCount: (finalScopes || []).length, hasActorToken: !!(actorToken), durationMs: Date.now()-_exchangeT0, request: _rfc8693Request, response: { aud: _rfc8693Response.aud, scope: _rfc8693Response.scope, hasActClaim: !!(_exchangedDecoded?.claims?.act) }, jwtFullDecode: _exchangedDecoded || undefined } });
  return exchangedToken;
}

/**
 * Perform transaction-tokens exchange (draft mode).
 * Currently implemented as RFC 8693 with transaction metadata wrapping.
 * Future: Replace with native transaction tokens exchange when PingOne SDK supports draft spec.
 * 
 * @param {string} userToken - User access token from session
 * @param {string|null} actorToken - Optional agent actor token  
 * @param {string} mcpResourceUri - Target audience for MCP token
 * @param {Array} finalScopes - Scopes to request in exchange
 * @returns {Promise<string|null>} - Exchanged MCP token or null on failure
 */
async function exchangeTokenWithTransactionTokens(userToken, actorToken, mcpResourceUri, finalScopes) {
  // Generate transaction ID
  const txnId = generateTransactionId();
  logger.debug(_CAT, `[TransactionTokens] Generated txnId: ${txnId}`);

  // For now: Use RFC 8693 exchange, then augment with transaction metadata
  // TODO: Replace with native transaction tokens exchange when PingOne API supports draft-oauth-transaction-tokens-for-agents-06
  const exchangedToken = await exchangeTokenRfc8693(userToken, actorToken, mcpResourceUri, finalScopes);

  if (exchangedToken) {
    logger.debug(_CAT, `[TransactionTokens] Success for txnId: ${txnId}`);
    // In future: Transaction metadata stored separately in session context (deferred to Plan 03)
  }
  
  return exchangedToken;
}

/**
 * Perform dual-mode token exchange based on TOKEN_EXCHANGE_MODE configuration.
 * Attempts primary mode, then falls back to secondary if enabled and primary fails.
 * 
 * @param {string} userToken - User access token from session
 * @param {string|null} actorToken - Optional agent actor token
 * @param {string} mcpResourceUri - Target audience for MCP token
 * @param {Array} finalScopes - Scopes to request in exchange
 * @returns {Promise<string|null>} - Exchanged MCP token or null on failure (permanent, not retryable)
 */
async function performDualModeTokenExchange(userToken, actorToken, mcpResourceUri, finalScopes) {
  const primaryMode = tokenExchangeConfig.mode;
  const fallbackMode = tokenExchangeConfig.getFallbackMode();
  const config = tokenExchangeConfig;
  
  if (!config.isValidMode(primaryMode)) {
    errorLog(`[TokenExchange] Invalid mode: ${primaryMode}. Defaulting to RFC 8693.`);
    return await exchangeTokenRfc8693(userToken, actorToken, mcpResourceUri, finalScopes);
  }
  
  // Attempt primary mode
  logger.info(_CAT, `[TokenExchange] Attempting ${primaryMode}`);
  let token = null;

  try {
    if (primaryMode === 'rfc_8693') {
      token = await exchangeTokenRfc8693(userToken, actorToken, mcpResourceUri, finalScopes);
    } else if (primaryMode === 'transaction_tokens') {
      token = await exchangeTokenWithTransactionTokens(userToken, actorToken, mcpResourceUri, finalScopes);
    }

    if (token) {
      logger.info(_CAT, `[TokenExchange] ${primaryMode} succeeded`);
      return token;
    }
  } catch (err) {
    errorLog(`[TokenExchange] ${primaryMode} failed:`, err.message);
  }
  
  // If primary failed and auto-fallback enabled, retry with fallback mode
  if (config.autoFallback && token === null) {
    if (config.logModeSwitches) {
      logger.info(_CAT, `[TokenExchange] Switching from ${primaryMode} to ${fallbackMode} (auto-fallback)`);
    }

    try {
      if (fallbackMode === 'rfc_8693') {
        token = await exchangeTokenRfc8693(userToken, actorToken, mcpResourceUri, finalScopes);
      } else {
        token = await exchangeTokenWithTransactionTokens(userToken, actorToken, mcpResourceUri, finalScopes);
      }

      if (token) {
        logger.info(_CAT, `[TokenExchange] Fallback to ${fallbackMode} succeeded`);
        return token;
      }
    } catch (err) {
      errorLog(`[TokenExchange] Fallback to ${fallbackMode} failed:`, err.message);
    }
  }
  
  return null;
}

/**
 * Enterprise-managed MCP path (Phase 2): IT policy gate + RFC 8693 as ID-JAG stand-in.
 * Throws with structured codes when policy denies or flag is off.
 */
async function resolveMcpTokenEnterpriseManaged(req, tokenEvents) {
  if (!isEnterpriseManagedFlagOn()) {
    const err = new Error('Enterprise-managed MCP authorization is not enabled.');
    err.code = 'enterprise_mcp_not_enabled';
    err.httpStatus = 400;
    err.tokenEvents = tokenEvents;
    throw err;
  }

  const policy = await enterpriseMcpPolicy.checkPolicy(req);
  if (!policy.allowed) {
    const err = new Error(policy.message || 'Enterprise MCP policy denied.');
    err.code = policy.code || 'enterprise_mcp_policy_denied';
    err.httpStatus = policy.httpStatus || 403;
    err.tokenEvents = tokenEvents;
    throw err;
  }

  if (req.session && !req.session.agentConsentGiven) {
    req.session.agentConsentGiven = true;
    req.session.agentConsentedAt = new Date().toISOString();
    req.session.enterpriseMcpAutoConnect = true;
  }

  tokenEvents.push(buildTokenEvent(
    'enterprise-managed-mode',
    'Enterprise-Managed MCP — IT policy passed (no Connect MCP step)',
    'active',
    null,
    'Enterprise-managed mode is ON. The user passed IT group/population policy. ' +
      'RFC 8693 token exchange below is an ID-JAG equivalent stand-in until PingOne ships native ID-JAG.',
    {
      rfc: 'MCP Enterprise-Managed Authorization',
      idJagStandIn: true,
      matchDetail: policy.matchDetail || null,
      resourceUris: enterpriseMcpPolicy.getAllowedResourceUris(),
    }
  ));

  logAppEvent('enterprise_mcp', 'info', 'enterprise_mcp.token_issued — proceeding to RFC 8693 stand-in exchange', {
    tag: 'enterprise_mcp/token_issued',
    metadata: { matchDetail: policy.matchDetail, userSub: req.session?.user?.oauthId },
  });

  return policy;
}

async function resolveMcpAccessTokenWithEvents(req, tool, opts = {}) {
  logger.debug(_CAT, `[AGENT_MCP] resolveAccessToken tool=${tool} session=${req.sessionID}`);

  const tokenEvents = [];
  const activeUseCaseId = resolveActiveUseCaseId(req);
  let userToken = getSessionBearerForMcp(req);

  if (!userToken) {
    logger.warn(_CAT, `[AGENT_MCP] No user token in session for tool=${tool}`);
    return { token: null, tokenEvents, userSub: null, need_auth: true, exchange_mode: '1-token', tratContextHeader: null };
  }

  const { userSub, userAccessTokenClaims: _rawUserClaims } = appendUserTokenEvent(tokenEvents, userToken, req);

  // ── Active-Token check (JWKS on the REAL user token) ──────────────────────
  // Verify the user's session token is still valid before attempting exchange.
  // Uses JWKS signature + expiry on the user's own token — NOT RFC 7662
  // introspection authenticated with the Worker client (PingOne rejects the
  // Worker client for introspection with 401, and the user token is a verifiable
  // JWT anyway).
  try {
    const intro = await jwksActiveCheckUserToken(userToken);
    const introStatus = intro.valid ? 'active' : 'failed';
    tokenEvents.push(buildTokenEvent(
      'user-token-introspection',
      'User Token — JWKS Validation (signature + expiry on the real token)',
      introStatus,
      // Pass introspection claims so the UI Claims tab shows real PingOne data
      intro.valid
        ? {
            header: null,
            claims: {
              sub: intro.sub,
              active: true,
              scope: Array.isArray(intro.scopes) ? intro.scopes.join(' ') : (intro.scopes || null),
              exp: intro.exp,
              aud: intro.aud,
              client_id: intro.client_id,
            },
          }
        : null,
      intro.valid
        ? `JWKS validation confirmed the user token is valid (signature + not expired). sub=${intro.sub} scope="${intro.scopes || ''}".`
        : `JWKS validation failed — the user session token is expired or invalid. The tool call cannot proceed safely with an inactive token.`,
      {
        rfc: 'RFC 7515 · RFC 7517 (JWKS)',
        introspectionResult: {
          active: intro.valid,
          sub: intro.sub,
          exp: intro.exp,
          aud: intro.aud,
          scope: intro.scopes,
          client_id: intro.client_id,
        },
      }
    ));
    if (!intro.valid) {
      // Attempt silent refresh before giving up — session may have a valid refresh token
      // even when the access token has expired (common after server restart with SQLite sessions).
      const refreshToken = req?.session?.oauthTokens?.refreshToken;
      if (refreshToken && refreshToken !== '_cookie_session') {
        try {
          const refreshed = await oauthService.refreshAccessToken(refreshToken);
          if (refreshed && refreshed.access_token) {
            req.session.oauthTokens.accessToken = refreshed.access_token;
            if (refreshed.refresh_token) req.session.oauthTokens.refreshToken = refreshed.refresh_token;
            req.session.oauthTokens.expiresAt = Date.now() + (refreshed.expires_in || 3600) * 1000;
            await new Promise((resolve, reject) =>
              req.session.save(err => err ? reject(err) : resolve())
            );
            userToken = refreshed.access_token;
            tokenEvents.push(buildTokenEvent(
              'user-token-refreshed',
              'User Token — Silently Refreshed (expired token replaced)',
              'active',
              null,
              'Access token was expired. BFF used the stored refresh token to obtain a new access token from PingOne. Token exchange will proceed with the fresh token.',
              { rfc: 'RFC 6749 §6' }
            ));
            logger.info(_CAT, '[AGENT_MCP] Access token silently refreshed via refresh_token — continuing exchange');
          } else {
            throw Object.assign(
              new Error('User token is no longer active (refresh returned no access_token)'),
              { code: 'TOKEN_INACTIVE' }
            );
          }
        } catch (refreshErr) {
          if (refreshErr.code === 'TOKEN_INACTIVE') throw refreshErr;
          logger.warn(_CAT, `[AGENT_MCP] Silent token refresh failed: ${refreshErr.message}`);
          throw Object.assign(
            new Error('User token is no longer active (JWKS validation failed — token expired/invalid; refresh also failed)'),
            { code: 'TOKEN_INACTIVE' }
          );
        }
      } else {
        throw Object.assign(
          new Error('User token is no longer active (JWKS validation failed — token expired/invalid)'),
          { code: 'TOKEN_INACTIVE' }
        );
      }
    }
  } catch (err) {
    if (err.code === 'TOKEN_INACTIVE') throw err;
    // JWKS endpoint unreachable or token undecodable — add skipped event, continue.
    tokenEvents.push(buildTokenEvent(
      'user-token-introspection',
      'User Token — JWKS Validation',
      'skipped',
      null,
      `JWKS validation skipped: ${err.message}. The exchange proceeds; PingOne still validates the subject token.`,
      { rfc: 'RFC 7515 · RFC 7517 (JWKS)' }
    ));
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── RFC 8693 may_act Support Configuration ───────────────────────────────
  // DEPRECATED: Synthetic may_act injection via ff_inject_may_act (kept for backwards compatibility).
  // New code should use enableMayActSupport with PingOne token policies for RFC 8693 compliance.
  const ffInjectMayAct =
    configStore.getEffective('ff_inject_may_act') === true ||
    configStore.getEffective('ff_inject_may_act') === 'true';

  let userAccessTokenClaims = _rawUserClaims;
  if (ffInjectMayAct && userAccessTokenClaims && !userAccessTokenClaims.may_act) {
    const bffClientId =
      oauthService.config?.clientId ||
      configStore.getEffective('user_client_id') ||
      process.env.PINGONE_CLIENT_ID ||
      null;
    if (bffClientId) {
      // DEPRECATED: Patch claims in memory only — the JWT itself is unchanged.
      // This is a backwards-compatibility shortcut. For production RFC 8693 compliance,
      // configure PingOne to add may_act natively via token policy + enableMayActSupport.
      userAccessTokenClaims = { ...userAccessTokenClaims, may_act: { client_id: bffClientId } };
      // Update the user-token event that was just pushed to reflect the injection.
      const utEvent = tokenEvents.find(e => e.id === 'user-token');
      if (utEvent) {
        utEvent.mayActPresent = true;
        utEvent.mayActValid   = true;
        utEvent.mayActInjected = true;
        utEvent.mayActDetails =
          `may_act synthesised by BFF (ff_inject_may_act = true): { client_id: "${bffClientId}" }. ` +
          'DEPRECATED: This is a demo/dev shortcut — enable may_act in your PingOne token policy and set enableMayActSupport=true for RFC 8693 compliance.';
        utEvent.explanation =
          (utEvent.explanation || '') +
          ` [BFF-INJECTED may_act: { client_id: "${bffClientId}" } — enable ff_inject_may_act is ON — DEPRECATED]`;
      }
      tokenEvents.push(buildTokenEvent(
        'may-act-injected',
        'may_act — BFF synthetic injection (DEPRECATED)',
        'active',
        null,
        `ff_inject_may_act is ON. The user access token had no may_act claim so the BFF has ` +
          `synthesised { client_id: "${bffClientId}" } in memory before attempting RFC 8693 token exchange. ` +
          'DEPRECATED: This is a demo/dev shortcut. For production RFC 8693 compliance, configure PingOne to add may_act natively ' +
          'via an attribute mapping expression, enable enableMayActSupport=true, then disable this flag.',
        { rfc: 'RFC 8693 §4.1', synthetic: true, deprecated: true, injectedValue: { client_id: bffClientId } }
      ));
    }
  }
  
  // ── RFC 8693 may_act Support Configuration (Production) ──────────────────
  // Validate RFC 8693-compliant may_act claims from PingOne token policies (not synthetic injection).
  const mayActSupported = configStore.getEffective('enableMayActSupport') === true ||
    configStore.getEffective('enableMayActSupport') === 'true';

  // ── PingOne doc compliance: hard-block exchange when may_act is absent ────
  // When ff_require_may_act=true the BFF enforces the PingOne securing-agents
  // doc requirement that the user token MUST carry a may_act claim before the
  // RFC 8693 exchange is attempted. Without may_act the delegated token cannot
  // carry an act claim, breaking the delegation chain required by the consent
  // agreement policy. Default false so existing deployments without PingOne
  // token-policy may_act support are unaffected; enable once PingOne is
  // configured to emit may_act (or set ff_inject_may_act=true for demo mode).
  const ffRequireMayAct =
    configStore.getEffective('ff_require_may_act') === true ||
    configStore.getEffective('ff_require_may_act') === 'true';

  if (ffRequireMayAct && !userAccessTokenClaims?.may_act) {
    const err = new Error(
      'RFC 8693 token exchange blocked: user access token is missing the may_act claim. ' +
      'The PingOne securing-agents doc requires may_act to be present before token exchange ' +
      'so the delegation chain (act claim) can be established. ' +
      'Configure the PingOne token policy to emit may_act on user tokens, or disable ' +
      'ff_require_may_act to allow exchange without it (weakens delegation audit trail).'
    );
    err.code = 'may_act_required';
    err.httpStatus = 403;
    err.tokenEvents = tokenEvents;
    tokenEvents.push(buildTokenEvent(
      'may-act-required-block',
      'Token Exchange (RFC 8693) — Blocked: may_act required',
      'error',
      null,
      'ff_require_may_act is ON and the user access token has no may_act claim. ' +
        'Exchange is blocked per PingOne securing-agents doc compliance. ' +
        'Configure PingOne to add may_act via a token policy attribute mapping, then retry.',
      { rfc: 'RFC 8693 §4.1', blocked: true }
    ));
    throw err;
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── ff_inject_scopes — Demo Scope Injection (Phase 146 — D-04) ───────────
  // When ON and the user access token lacks * scopes, the BFF injects
  // read and write into the local claim snapshot. This lets the
  // demo flow proceed without a PingOne custom resource server. All injections are
  // logged to tokenEvents with [BFF-INJECTED] labels (visible in Token Chain UI).
  // Pattern mirrors ff_inject_may_act and ff_inject_audience.
  const ffInjectScopes =
    configStore.getEffective('ff_inject_scopes') === true ||
    configStore.getEffective('ff_inject_scopes') === 'true';
  if (ffInjectScopes && userAccessTokenClaims) {
    const existingScopes = (typeof userAccessTokenClaims.scope === 'string'
      ? userAccessTokenClaims.scope.split(' ')
      : (userAccessTokenClaims.scope || []))
      .filter(Boolean);
    const hasBankingScopes = existingScopes.some(s => s === 'read' || s === 'write');
    if (!hasBankingScopes) {
      const injectedScopeNames = ['read', 'write'];
      userAccessTokenClaims = {
        ...userAccessTokenClaims,
        scope: (userAccessTokenClaims.scope || '') + ' ' + injectedScopeNames.join(' '),
        injected_scope_names: injectedScopeNames,
      };
      const utEvent = tokenEvents.find(e => e.id === 'user-token');
      if (utEvent) {
        utEvent.scopeInjected = true;
        utEvent.injectedScopeNames = injectedScopeNames;
        utEvent.explanation =
          (utEvent.explanation || '') +
          ` [BFF-INJECTED scopes: ${injectedScopeNames.join(', ')} — ff_inject_scopes is ON]`;
      }
      tokenEvents.push(buildTokenEvent(
        'scopes-injected',
        'Banking Scopes — BFF synthetic injection (Demo Mode)',
        'active',
        null,
        `ff_inject_scopes is ON. The user access token had no data scopes so the BFF has ` +
          `injected ${injectedScopeNames.join(', ')} in memory before attempting RFC 8693 token exchange. ` +
          'This is a demo/dev shortcut. In production, configure a PingOne custom resource server to issue tokens with banking scopes.',
        { synthetic: true, injectedScopes: injectedScopeNames }
      ));
      warnLog(
        `[SCOPE_INJECTION] Banking scopes injected: ${injectedScopeNames.join(', ')}. ` +
        `User token had no data scopes. ff_inject_scopes = true (demo mode).`
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (isEnterpriseManagedFlagOn()) {
    await resolveMcpTokenEnterpriseManaged(req, tokenEvents);
  }

  // ── ff_skip_token_exchange — direct user token path (no RFC 8693) ────────
  // When ON the user access token is forwarded to MCP unchanged. No actor token
  // is acquired and no exchange is performed. Useful when PingOne is not yet
  // configured for token exchange. The alternative (OFF) is the full on-behalf-of
  // exchange: agent client-credentials token + RFC 8693 → scoped MCP token + act claim.
  const ffSkipExchange =
    configStore.getEffective('ff_skip_token_exchange') === true ||
    configStore.getEffective('ff_skip_token_exchange') === 'true';
  if (ffSkipExchange) {
    tokenEvents.push(buildTokenEvent(
      'exchange-skipped',
      'Token Exchange (RFC 8693) — Bypassed',
      'skipped',
      null,
      'ff_skip_token_exchange is ON. The user access token is passed directly to the MCP server without RFC 8693 exchange. ' +
        'The MCP server receives the user\'s original token (no act claim, no audience narrowing). ' +
        'Alternative — turn this flag OFF: the BFF performs a full RFC 8693 on-behalf-of exchange, ' +
        'minting a scoped MCP token with act: { client_id: <agent> } for audit provenance. ' +
        'In production always use token exchange.',
      { rfc: 'RFC 8693', bypass: true }
    ));
    return { token: userToken, tokenEvents, userSub, tratContextHeader: null };
  }
  // ─────────────────────────────────────────────────────────────────────────

  const mcpResourceUri = configStore.getEffective('pingone_resource_mcp_server_uri');
  // CATALOG (not an authz oracle): MCP_TOOL_SCOPES maps a tool → the OAuth
  // scopes the RFC 8693 exchange should request for it. It drives scope
  // resolution below; it does NOT decide whether the call is allowed.
  // Shallow-copy so admin scope injection below never mutates the shared MCP_TOOL_SCOPES map.
  // opts.scopeOverride lets tool discovery (tools/list) request a specific scope set
  // (the write-toggle's resolved scopes) instead of a single tool's scopes — the
  // exchange still narrows to the intersection with the user token's scopes below.
  const toolCandidateScopes = (
    Array.isArray(opts.scopeOverride) && opts.scopeOverride.length
      ? opts.scopeOverride
      : (MCP_TOOL_SCOPES[tool] || ['read'])
  ).slice();

  // Classify tool as high-risk (write) so the UI can label the Token Chain accordingly.
  const isHighRiskTool = toolCandidateScopes.some(
    s => s.includes(':write') || s === 'write'
  );
  const toolTrigger = isHighRiskTool ? 'high_risk' : 'read_only';

  // Architecture-note R1 (2026-05-15) / T-2: the former local
  // `agentMcpScopePolicy` scope-allow-list veto used to throw
  // `agent_mcp_scope_denied` (403) here, deciding tool authorization in the
  // BFF. That was a redundant SECOND authorization layer. It has been removed:
  // whether a tool call is permitted is now decided ONLY by PingAuthorize via
  // `mcpToolAuthorizationService.evaluateMcpFirstToolGate` (server.js — runs
  // unconditionally on every MCP tool call after this token resolves). Do not
  // reintroduce a local scope-permit decision in this function.

  // ── Scope resolution: no fallbacks (RFC 8693 §2.1 + RFC 8707) ────────────
  // Two explicit paths — no silent fallbacks, no hard-coded defaults:
  //
  // Path A — Direct intersection: user token carries at least one tool scope
  //   → finalScopes = toolCandidateScopes ∩ userTokenScopes
  //
  // Path B — Delegation: user token carries ai:agent:read
  //   → PingOne token-exchange policy on the MCP resource decides whether to
  //     grant the tool's scopes from the delegation scope. Pass toolCandidateScopes
  //     directly and let PingOne adjudicate.
  //
  // Anything else → fail fast with a clear error message.
  //
  // DELEGATION_ONLY_SCOPES are NOT valid resource-access scopes on the MCP server
  // — they cannot be used as exchange scopes themselves.
  const DELEGATION_ONLY_SCOPES = new Set(['ai:agent:read', 'ai_agent']);

  const userTokenScopes = new Set(
    (typeof userAccessTokenClaims?.scope === 'string'
      ? userAccessTokenClaims.scope.split(' ')
      : (userAccessTokenClaims?.scope || [])
    ).filter(Boolean)
  );

  // Path A: direct intersection
  const directScopes = toolCandidateScopes.filter(
    (s) => userTokenScopes.has(s) && !DELEGATION_ONLY_SCOPES.has(s)
  );

  // Path B: user holds the delegation scope; PingOne policy decides
  const userHasDelegationScope = userTokenScopes.has('ai:agent:read');

  let finalScopes;
  let scopeResolutionPath;

  if (directScopes.length > 0) {
    // Path A: use the exact intersection — no guessing
    finalScopes = directScopes;
    scopeResolutionPath = 'direct-intersection';
  } else if (userHasDelegationScope) {
    // Path B: delegation — pass tool scopes, PingOne policy decides
    finalScopes = toolCandidateScopes.filter((s) => !DELEGATION_ONLY_SCOPES.has(s));
    scopeResolutionPath = 'delegation-via-agent-invoke';
    if (finalScopes.length === 0) {
      const userScopesStr = [...userTokenScopes].join(' ') || '(none)';
      const err = new Error(
        `Token exchange failed: tool ${tool} has no non-delegation candidate scopes. ` +
        `Tool scopes: [${toolCandidateScopes.join(', ')}]. User scopes: [${userScopesStr}].`
      );
      err.code = 'no_exchangeable_scopes';
      err.httpStatus = 403;
      err.tokenEvents = tokenEvents;
      throw err;
    }
  } else {
    // No path — fail fast, never silently downgrade
    const userScopesStr = [...userTokenScopes].join(' ') || '(none)';
    const requiredBase = 'ai:agent:read (delegation) or one of: ' + toolCandidateScopes.join(', ');
    const tokenSub = userAccessTokenClaims?.sub || '(unknown)';
    const tokenAud = Array.isArray(userAccessTokenClaims?.aud)
      ? userAccessTokenClaims.aud.join(', ')
      : (userAccessTokenClaims?.aud || '(unknown)');
    const tokenClientId = userAccessTokenClaims?.client_id || '(unknown)';
    const err = new Error(
      `Token exchange blocked: user token [${userScopesStr}] lacks required scopes for tool ${tool}. ` +
      `Token: sub=${tokenSub}, aud=${tokenAud}, client_id=${tokenClientId}. ` +
      `Need ${requiredBase}. Sign in again with the correct PingOne app and scopes.`
    );
    err.code = 'missing_exchange_scopes';
    err.httpStatus = 403;
    err.tokenEvents = tokenEvents;
    err.missingScopes = toolCandidateScopes;
    err.userScopes = userScopesStr;
    err.tokenSub = tokenSub;
    err.tokenAud = tokenAud;
    err.tokenClientId = tokenClientId;
    throw err;
  }

  // RFC 8707: validate scopes against target audience — fail fast if invalid
  const scopeValidation = configStore.validateScopeAudience(finalScopes, mcpResourceUri);
  finalScopes = scopeValidation.scopes;

  // Ensure mcp:invoke is included in MCP tokens (required by MCP Gateway policy)
  if (!finalScopes.includes('mcp:invoke')) {
    logger.debug(_CAT, `[TokenExchange] Adding mcp:invoke to finalScopes: [${finalScopes.join(',')}] → [${[...finalScopes, 'mcp:invoke'].join(',')}]`);
    finalScopes.push('mcp:invoke');
  } else {
    logger.debug(_CAT, `[TokenExchange] mcp:invoke already in finalScopes: [${finalScopes.join(',')}]`);
  }

  void writeExchangeEvent({
    type: 'scope-resolution',
    level: 'info',
    message: `[${scopeResolutionPath}] Scopes for tool ${tool}: [${finalScopes.join(', ')}]`,
    tool,
    path: scopeResolutionPath,
    userScopes: [...userTokenScopes].join(' '),
    finalScopes,
    audience: mcpResourceUri,
  });

  // Alias: downstream code references effectiveToolScopes
  const effectiveToolScopes = finalScopes;

  // ── Scope debug log ─────────────────────────────────────────────────────
  logger.debug(_CAT,
    `[TokenExchange] tool=${tool} path=${scopeResolutionPath} userScopes=[${[...userTokenScopes].join(',') || '(none)'}] candidates=[${toolCandidateScopes.join(',')}] final=[${finalScopes.join(',')}] aud=${mcpResourceUri || '(not set)'}`
  );

  // ── 2-Exchange delegation path ──────────────────────────────────────────────────
  // 12-step AI agent security mandate: two RFC 8693 exchanges are ALWAYS required.
  // Session mode 'single' is a debug-only escape hatch; 'double' is the mandatory default.
  const sessionExchangeMode = req && req.session ? req.session.mcpExchangeMode : undefined;
  const ffTwoExchange = sessionExchangeMode !== 'single';
  if (ffTwoExchange) {
    return await _performTwoExchangeDelegation(
      tokenEvents, userToken, finalScopes, userSub, toolTrigger, mcpResourceUri, req
    );
  }
  // ────────────────────────────────────────────────────────────────────

  // Always use actor token when agent OAuth client is configured — ensures on_behalf_of semantics
  // (the exchanged MCP token carries act: { client_id: <agent> } proving which client is acting).
  // Without PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID the exchange runs subject-only (still RFC 8693; user token
  // is NEVER forwarded to MCP — but the act claim is absent, weakening audit provenance).
  const useActor = !!configStore.getEffective('pingone_mcp_token_exchanger_client_id');

  if (!mcpResourceUri) {
    tokenEvents.push(buildTokenEvent(
      'exchange-required',
      'Token Exchange (RFC 8693) — Not Configured',
      'skipped',
      null,
      'RFC 8693 token exchange is not configured. Set mcp_resource_uri in the Admin → Config UI ' +
        '(or MCP_RESOURCE_URI env) to the MCP resource audience URI. ' +
        'Banking tools are running via local fallback — the user access token is not forwarded to MCP.',
      { rfc: 'RFC 8693 · RFC 8707', trigger: toolTrigger }
    ));
    // Return null token — server.js will route to the local tool handler.
    // The User Token is never forwarded to MCP from this path.
    return { token: null, tokenEvents, userSub, tratContextHeader: null };
  }

  // ── Optional BFF synthetic audience injection ─────────────────────────────
  // When ff_inject_audience is true and the user token's aud claim does not already
  // include mcp_resource_uri, the BFF adds it to the local claim snapshot in memory.
  // Some PingOne token-exchange policies require the subject token to be valid for the
  // requested audience (RFC 8707 resource indicators). Educational/demo only — the JWT
  // itself is unchanged; only the BFF's internal snapshot is updated for Token Chain display.
  const ffInjectAudience =
    configStore.getEffective('ff_inject_audience') === true ||
    configStore.getEffective('ff_inject_audience') === 'true';

  if (ffInjectAudience && userAccessTokenClaims) {
    const currentAud = userAccessTokenClaims.aud;
    const audArr = Array.isArray(currentAud) ? currentAud : (currentAud ? [currentAud] : []);
    const audAlreadyPresent = audArr.includes(mcpResourceUri);

    if (!audAlreadyPresent) {
      userAccessTokenClaims = { ...userAccessTokenClaims, aud: [...audArr, mcpResourceUri] };
      const utEvent = tokenEvents.find(e => e.id === 'user-token');
      if (utEvent) {
        utEvent.audInjected = true;
        utEvent.explanation =
          (utEvent.explanation || '') +
          ` [BFF-INJECTED aud: "${mcpResourceUri}" — enable ff_inject_audience is ON]`;
      }
      tokenEvents.push(buildTokenEvent(
        'audience-injected',
        'Audience — BFF synthetic injection',
        'active',
        null,
        `ff_inject_audience is ON. The user access token's aud claim (${JSON.stringify(currentAud)}) did not include ` +
          `the MCP resource URI "${mcpResourceUri}". ` +
          `The BFF has added "${mcpResourceUri}" to the aud claim snapshot in memory before RFC 8693 exchange. ` +
          'Some PingOne token-exchange policies require the subject token to carry the resource URI in its aud ' +
          '(RFC 8707 resource indicators). The JWT itself is unchanged — only the local claim snapshot is updated. ' +
          'Configure PingOne to include the resource URI in issued access tokens to remove this shortcut.',
        { rfc: 'RFC 8693 §2.1 · RFC 8707', synthetic: true, injectedValue: mcpResourceUri }
      ));
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const scopeCount = countJwtScopes(userAccessTokenClaims);
  if (scopeCount < MIN_USER_SCOPES_FOR_MCP) {
    tokenEvents.push(buildTokenEvent(
      'user-scopes-insufficient',
      'User access token — insufficient scopes for MCP exchange',
      'failed',
      decodeJwtClaims(userToken),
      `User access token has ${scopeCount} scope(s); at least ${MIN_USER_SCOPES_FOR_MCP} are required. ` +
        'Request a broader scope set at login so PingOne can narrow to MCP-only scopes after exchange.',
      { rfc: 'RFC 8693', scopeCount, minRequired: MIN_USER_SCOPES_FOR_MCP }
    ));
    throwTokenResolutionError(
      tokenEvents,
      'user_token_insufficient_scopes',
      `User token must include at least ${MIN_USER_SCOPES_FOR_MCP} distinct OAuth scopes (found ${scopeCount}). Re-authorize with more scopes.`,
      403
    );
  }

  // ── Event 2a: Agent actor client-credentials token (required for on_behalf_of) ─
  if (!useActor) {
    logger.warn(_CAT,
      '[agentMcpTokenService] PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID not set — RFC 8693 exchange will run subject-only (no act claim). Set PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID + PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET for full on_behalf_of semantics.'
    );
    tokenEvents.push(buildTokenEvent(
      'agent-actor-token-unavailable',
      'Agent OAuth Client Not Configured',
      'degraded',
      null,
      'No MCP token exchanger client ID is configured (PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID is unset). ' +
      'The RFC 8693 exchange will proceed as subject-only — the returned MCP token will have no act claim, ' +
      'meaning there is no cryptographic proof of which agent acted on behalf of the user.',
      {
        reason: 'not-configured',
        impact: 'act claim will be absent from exchanged token',
        rfc: 'RFC 8693 §4.4',
      }
    ));
  }

  let actorToken = null;
  if (useActor) {
    try {
      // Per-user may_act (default on): the actor_token must be the client the user
      // authorized (the AI Agent = may_act.sub) so PingOne emits a NATIVE `act` claim
      // (resource SPEL: may_act.sub == actorToken.client_id). The exchange still
      // authenticates AS the Exchanger below (it holds the mcp grant); only the
      // actor_token identity changes. enforce_may_act=false → legacy exchanger actor.
      const enforceMayAct = String(
        configStore.getEffective('enforce_may_act') || process.env.ENFORCE_MAY_ACT || 'true'
      ).toLowerCase() !== 'false';
      actorToken = enforceMayAct
        ? await oauthService.getAiAgentClientCredentialsToken()
        : await oauthService.getMcpExchangerToken();
      const a0Decoded = decodeJwtClaims(actorToken);
      const actorClientId = enforceMayAct
        ? (configStore.getEffective('pingone_ai_agent_client_id') || process.env.PINGONE_AI_AGENT_CLIENT_ID)
        : configStore.getEffective('pingone_mcp_token_exchanger_client_id');
      tokenEvents.push(buildTokenEvent(
        'agent-actor-token',
        'Agent access token (client credentials)',
        'active',
        a0Decoded,
        `Client-credentials token for the ${enforceMayAct ? 'AI Agent' : 'MCP Token Exchanger'} OAuth client (${actorClientId}). ` +
        'Used as actor_token in the RFC 8693 exchange — the resulting MCP access token will carry ' +
        `act: { sub: ${actorClientId} } identifying the agent as the current actor.`,
        { rfc: 'RFC 8693 §2.1 (actor_token)' }
      ));
      // JWKS verify the agent CC token — it's PingOne-signed, same as any other JWT
      await pushJwksVerifyEvent(actorToken, tokenEvents, 'agent-actor-token-verified', 'Agent Actor Token (CC)');
    } catch (err) {
      tokenEvents.push(buildTokenEvent(
        'agent-actor-token-unavailable',
        'Agent OAuth Client Token Failed',
        'failed',
        null,
        'The MCP token exchanger failed to obtain a client credentials token. ' +
        'RFC 8693 exchange cannot include an actor token — the MCP token will have no act claim.',
        {
          reason: 'fetch-failed',
          impact: 'act claim will be absent from exchanged token',
          rfc: 'RFC 8693 §4.4',
          error: err.message,
        }
      ));
      actorToken = null;
    }
  }

  // ── Event 2b: Token exchange attempt ────────────────────────────────────────
  tokenEvents.push(buildTokenEvent(
    'exchange-in-progress',
    'Token exchange (RFC 8693): user access token → MCP access token',
    'acquiring',
    null,
    `Backend-for-Frontend (BFF) is exchanging the user access token for a delegated MCP access token scoped to audience=${mcpResourceUri}, ` +
    `scope="${finalScopes.join(' ')}".`,
    {
      rfc: 'RFC 8693 · RFC 8707 (resource indicator)',
      trigger: toolTrigger,
      exchangeRequest: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: mcpResourceUri,
        scope: finalScopes.join(' '),
        has_actor_token: !!actorToken,
      },
    }
  ));

  // UC19 — retired agent identity: block exchange before contacting PingOne.
  if (shouldSimulateRetiredAgentExchange(activeUseCaseId)) {
    const inProgressIdx = tokenEvents.findIndex((e) => e.id === 'exchange-in-progress');
    if (inProgressIdx !== -1) tokenEvents.splice(inProgressIdx, 1);
    tokenEvents.push(buildTokenEvent(
      'exchange-failed',
      'Token Exchange (RFC 8693) — Agent identity retired',
      'failed',
      null,
      'The agent application credential was retired in PingOne — token exchange is denied (401). ' +
        'Non-human identities need the same lifecycle as human ones; a revoked client credential ' +
        'cannot mint delegated tokens.',
      {
        rfc: 'RFC 8693',
        httpStatus: 401,
        useCaseId: activeUseCaseId,
        agentIdentityRetired: true,
      },
    ));
    stampTokenEventsForUseCase(tokenEvents, activeUseCaseId);
    logAppEvent('token_exchange', 'error',
      'UC19 agent identity lifecycle — exchange blocked (retired credential)',
      { tag: 'token-exchange/retired-agent', useCaseId: activeUseCaseId });
    const retiredErr = new Error('Agent identity retired — credential no longer mints tokens');
    retiredErr.httpStatus = 401;
    retiredErr.code = 'AGENT_IDENTITY_RETIRED';
    retiredErr.tokenEvents = tokenEvents;
    throw retiredErr;
  }

  const exchangeOptions = buildJitExchangeOptions(activeUseCaseId);

  // ── Perform exchange ─────────────────────────────────────────────────────────
  let exchangedToken = null;
  let exchangeMethod = 'subject-only';
  // How the exchange-performing client authenticated to the PingOne token endpoint,
  // surfaced on the exchange token event (token chain / reports). Truthful per
  // branch: the MCP Exchanger client uses its own client_secret and is NOT switched
  // by ff_token_auth_private_key_jwt (scope = BFF/admin client) — so it stays
  // basic/post even when the flag is on. The admin-client fallback paths DO honor
  // the flag via applyAdminTokenEndpointClientAuth.
  let exchangeClientAuthMethod = null;
  const adminExchangeAuthMethod = () => clientAssertionService.resolveAuthMethod(
    configStore.getEffective('pingone_token_exchange_auth_method') || 'post'
  );

  try {
    // Prefer dedicated private_key_jwt exchanger when enabled, fall back to cc exchanger, then admin client
    const isDedicatedExchangerEnabled = _flagOn('ff_private_key_jwt_token_exchange');
    const dedicatedExchangerId = configStore.getEffective('pingone_private_key_jwt_exchanger_client_id');
    const ccExchangerId = configStore.getEffective('pingone_mcp_token_exchanger_client_id');
    const ccExchangerSecret = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');

    if (isDedicatedExchangerEnabled && dedicatedExchangerId) {
      // Use dedicated private_key_jwt app (supports both with and without actor)
      exchangedToken = await oauthService.performTokenExchangeWithDedicatedApp(
        userToken, mcpResourceUri, finalScopes, actorToken || null, exchangeOptions
      );
      exchangeClientAuthMethod = 'private_key_jwt';
      exchangeMethod = actorToken ? 'with-actor-dedicated' : 'dedicated';
    } else if (actorToken) {
      // Use MCP Token Exchanger credentials (cc) when available for actor flow
      if (ccExchangerId && ccExchangerSecret) {
        const exchangerAuthMethod = (
          process.env.PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD ||
          process.env.PINGONE_MCP_TOKEN_EXCHANGER_AUTH_METHOD ||
          'post'
        ).toLowerCase();
        exchangedToken = await oauthService.performTokenExchangeAs(
          userToken, actorToken, ccExchangerId, ccExchangerSecret, mcpResourceUri, finalScopes, exchangerAuthMethod, exchangeOptions
        );
        exchangeClientAuthMethod = exchangerAuthMethod;
      } else {
        exchangedToken = await oauthService.performTokenExchangeWithActor(
          userToken, actorToken, mcpResourceUri, finalScopes, exchangeOptions
        );
        exchangeClientAuthMethod = adminExchangeAuthMethod();
      }
      exchangeMethod = 'with-actor';
    } else {
      exchangedToken = await oauthService.performTokenExchange(
        userToken, mcpResourceUri, finalScopes, exchangeOptions
      );
      exchangeClientAuthMethod = adminExchangeAuthMethod();
    }

    // Decode MCP access token to show act claim in the UI
    const mcpAccessTokenDecoded = decodeJwtClaims(exchangedToken);
    const mcpAccessTokenClaims = mcpAccessTokenDecoded?.claims;

    // ── RFC 8693 §3: Subject Preservation Validation ────────────────────────
    // Verify that the exchanged token preserves the original user's subject claim.
    if (exchangedToken && mcpAccessTokenClaims && mcpAccessTokenClaims.sub && mcpAccessTokenClaims.sub !== userSub) {
      logger.warn(_CAT, '[RFC 8693 SECURITY] Subject mismatch in token exchange', {
        original_sub: userSub,
        exchanged_sub: mcpAccessTokenClaims.sub,
        audience: mcpResourceUri,
        scope: finalScopes.join(' '),
      });
      tokenEvents.push(buildTokenEvent(
        'subject-preservation-mismatch',
        'RFC 8693 Subject — Mismatch Detected',
        'warning',
        null,
        `Subject claim mismatch detected in token exchange. Original: ${userSub}, Exchanged: ${mcpAccessTokenClaims.sub}. RFC 8693 §3 requires subject preservation.`,
        {
          rfc: 'RFC 8693 §3',
          original_sub: userSub,
          exchanged_sub: mcpAccessTokenClaims.sub,
        }
      ));
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Replace the in-progress event with the completed result
    const inProgressIdx = tokenEvents.findIndex(e => e.id === 'exchange-in-progress');
    if (inProgressIdx !== -1) tokenEvents.splice(inProgressIdx, 1);

    // Validate that the issued MCP access token's aud actually matches what was requested.
    const mcpTokenAud = mcpAccessTokenClaims?.aud;
    const audMatches = mcpTokenAud === mcpResourceUri ||
      (Array.isArray(mcpTokenAud) && mcpTokenAud.includes(mcpResourceUri));

    const enterpriseStandIn = isEnterpriseManagedFlagOn();
    const standInNote = enterpriseStandIn
      ? ' ID-JAG equivalent (RFC 8693 stand-in) — native ID-JAG pending PingOne product support.'
      : '';
    const jitNote = activeUseCaseId === JIT_EPHEMERAL
      ? ` UC17 JIT credential — token_lifetime=${JIT_TOKEN_LIFETIME_SEC}s (expires in minutes, not days).`
      : '';

    tokenEvents.push(buildTokenEvent(
      'exchanged-token',
      enterpriseStandIn
        ? 'MCP access token (ID-JAG equivalent — RFC 8693 stand-in) → MCP server'
        : 'MCP access token (delegated) → MCP server',
      'exchanged',
      mcpAccessTokenDecoded,
      'PingOne issued the MCP access token.' + standInNote + jitNote + ' ' +
      (mcpAccessTokenClaims?.act
        ? `act: ${JSON.stringify(mcpAccessTokenClaims.act)} — the Backend-for-Frontend (BFF) is acting on behalf of the user. ` +
          'Resource servers use act to identify the current actor for audit and policy decisions.'
        : 'act claim not present — PingOne may not have applied delegation policy. ') +
      `Audience narrowed to ${mcpResourceUri} (aud=${JSON.stringify(mcpTokenAud)}${audMatches ? ' ✅' : ' ❌ mismatch'}), scope narrowed to "${effectiveToolScopes.join(' ')}". ` +
      'The user access token (your original login token) NEVER leaves the Backend-for-Frontend (BFF) — only the MCP access token reaches the MCP server.',
      {
        rfc: 'RFC 8693 · RFC 8707',
        trigger: toolTrigger,
        exchangeMethod,
        clientAuthMethod: exchangeClientAuthMethod,
        actPresent: !!mcpAccessTokenClaims?.act,
        actDetails: mcpAccessTokenClaims?.act ? JSON.stringify(mcpAccessTokenClaims.act) : null,
        audienceNarrowed: mcpResourceUri,
        audMatches,
        audExpected: mcpResourceUri,
        audActual: mcpTokenAud,
        scopeNarrowed: effectiveToolScopes.join(' '),
        idJagStandIn: enterpriseStandIn,
        exchangeRequest: {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          actor_token_present: Boolean(actorToken),
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          scope: Array.isArray(effectiveToolScopes) ? effectiveToolScopes.join(' ') : String(effectiveToolScopes || ''),
          audience: mcpResourceUri || null,
          ...(exchangeOptions.tokenLifetime != null ? { token_lifetime: exchangeOptions.tokenLifetime } : {}),
        },
        ...(activeUseCaseId ? { useCaseId: activeUseCaseId } : {}),
        ...(exchangeOptions.tokenLifetime != null ? { tokenLifetime: exchangeOptions.tokenLifetime } : {}),
      }
    ));

    // Write success to cross-Lambda audit log (fire-and-forget)
    void writeExchangeEvent({
      type: 'exchange-success',
      level: 'info',
      message: `[TokenExchange] Issued MCP access token — audience=${mcpResourceUri} method=${exchangeMethod} act=${!!mcpAccessTokenClaims?.act}`,
      exchangeMethod,
      mcpResourceUri,
      scopeNarrowed: effectiveToolScopes.join(' '),
      actPresent: !!mcpAccessTokenClaims?.act,
      audMatches,
    });

    // ── RFC 7515/7517/7518 — JWKS Signature Verification ─────────────────────
    // Verify the exchanged token's RS256 signature using PingOne's published JWKS.
    try {
      const verif = await tokenVerificationService.verifyExchangedToken(exchangedToken);
      const isIntrospectionFallback = verif.fallbackMethod === 'introspection';
      const eventLabel = isIntrospectionFallback
        ? 'MCP Token — Introspection Fallback (RFC 7662) · JWKS Unavailable'
        : 'MCP Token — JWKS Cryptographic Signature Verification (RFC 7515)';
      let explanation;
      if (verif.verified && !isIntrospectionFallback) {
        explanation = `Signature verified ✅ — PingOne's public key (kid=${verif.kid}, alg=${verif.alg}) confirms the token has not been tampered with since issuance. RFC 7515 §4.`;
      } else if (verif.verified && isIntrospectionFallback) {
        explanation = `JWKS unavailable — fell back to RFC 7662 introspection ✅. PingOne confirmed the exchanged token is active (liveness check). Cryptographic tamper-detection was skipped; this is acceptable because the token was received directly from PingOne milliseconds ago.`;
      } else if (verif.warning) {
        explanation = isIntrospectionFallback
          ? `Both JWKS and introspection fallback produced a warning: ${verif.warning}.`
          : `Signature check produced a warning (fail-open): ${verif.warning}. Set JWKS_VERIFY_FAIL_OPEN=false to hard-fail.`;
      } else {
        explanation = `Verification FAILED ❌ — ${verif.error}. The MCP token may have been tampered with or have expired.`;
      }
      tokenEvents.push(buildTokenEvent(
        'exchanged-token-verified',
        eventLabel,
        verif.verified ? 'active' : (verif.warning ? 'warning' : 'failed'),
        verif.verified ? verif.claims : null,
        explanation,
        {
          rfc: isIntrospectionFallback ? 'RFC 7662 (fallback) · RFC 7515 attempted' : 'RFC 7515 · RFC 7517 · RFC 7518',
          verified: verif.verified,
          fallbackMethod: verif.fallbackMethod,
          alg: verif.alg,
          kid: verif.kid,
          warning: verif.warning,
          error: verif.error,
        }
      ));
    } catch (verifErr) {
      // Never let JWKS verification block the tool call (fail-open by design)
      tokenEvents.push(buildTokenEvent(
        'exchanged-token-verified',
        'MCP Token — JWKS Signature Verification (RFC 7515)',
        'skipped',
        null,
        `JWKS verification skipped: ${verifErr.message}`,
        { rfc: 'RFC 7515 · RFC 7517' }
      ));
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Record exchanged token into tokenChainService so /api/token-chain/current returns live data.
    // CR-04 fix: do NOT pass the raw bearer JWT — pass only sanitised decoded claims so the
    // live credential is never stored in the in-memory token-chain Map and never retrievable
    // via the /api/token-chain or /api/api-calls endpoints.
    if (exchangedToken && userSub) {
      const _mcpClaims = mcpAccessTokenClaims || decodeJwtClaims(exchangedToken)?.claims || {};
      trackTokenEvent({
        eventType: 'exchange',
        token: '',  // intentionally blank — raw JWT must not be persisted
        userId: userSub,
        description: `RFC 8693 token exchange → MCP access token (audience=${mcpResourceUri}, method=${exchangeMethod})`,
        additionalData: {
          mcpResourceUri,
          exchangeMethod,
          tool,
          claims: {
            sub: _mcpClaims.sub,
            aud: _mcpClaims.aud,
            scope: _mcpClaims.scope,
            exp: _mcpClaims.exp,
            actPresent: !!_mcpClaims.act,
          },
        },
      }).catch(err => {
        logger.error(_CAT, `[TokenExchange] Failed to track token event: ${err.message}`);
      });

      // Track token for API call display — pass only claim summary, not the raw JWT.
      trackToken(req.session?.id || 'default', {
        token: '',  // intentionally blank — raw JWT must not be persisted
        tokenType: 'exchanged_token',
        description: `MCP Access Token (${exchangeMethod}) — aud=${Array.isArray(_mcpClaims.aud) ? _mcpClaims.aud.join(',') : (_mcpClaims.aud || 'unknown')}`,
      });
    }

    let tratContextHeader = null;

    // ── TraT Mode: build context and emit trat token event ───────────────────
    try {
      const _tratRaw = configStore.getEffective('ff_trat_mode');
      const ffTratMode = _tratRaw === true || _tratRaw === 'true';

      const { ffDpop, ffRar, extras } = _buildAgenticExtras(req, tool, userSub, tokenEvents);
      if ((ffTratMode || ffDpop || ffRar) && exchangedToken) {
        const agentClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || '';
        const gatewayClientId =
          configStore.getEffective('pingone_ai_agent_client_id') ||
          process.env.PINGONE_AI_AGENT_CLIENT_ID || '';

        const tratCtx = buildTratContext(req, tool, userSub, agentClientId, gatewayClientId, extras);

        // Check if PingOne emitted reqctx natively in the exchanged token
        const exchangedDecoded = decodeJwtClaims(exchangedToken);
        const hasNativeReqctx = !!(exchangedDecoded?.claims?.reqctx);

        const isSim = !hasNativeReqctx;
        // Carry the envelope whenever TraT is simulated OR it carries a DPoP cnf.jkt /
        // RAR authorization_details — otherwise (native TraT but simulated DPoP) the
        // cnf.jkt would be dropped and the gateway could not bind the proof.
        if (isSim || extras.cnfJkt || extras.rarDetails) {
          tratContextHeader = JSON.stringify({ ...tratCtx, trat_sim: isSim });
        }

        tokenEvents.push(buildTokenEvent(
          'trat-context',
          isSim
            ? 'Transaction Token (TraT) — Simulation Mode'
            : 'Transaction Token (TraT) — PingOne Native',
          isSim ? 'active' : 'success',
          null,
          isSim
            ? 'ff_trat_mode is ON. PingOne did not emit reqctx in the exchanged token — activating simulation shim. ' +
              'TraT context will be forwarded as X-TraT-Context header to the MCP server. ' +
              'trat_sim: true marks this as a simulation. ' +
              'To get native TraT claims, run `npm run pingone:setup:trat` to configure the PingOne token policy.'
            : 'ff_trat_mode is ON. PingOne emitted reqctx natively in the exchanged token. ' +
              'TraT claims are embedded in the bearer token — no simulation header needed.',
          {
            rfc: 'draft-oauth-transaction-tokens-for-agents-00',
            tratContext: {
              reqctx: tratCtx.reqctx,
              purp: tratCtx.purp,
              azd: tratCtx.azd,
              rctx: tratCtx.rctx,
            },
            trat_sim: isSim,
            nativeClaims: !isSim,
          }
        ));
      }
      // ─────────────────────────────────────────────────────────────────────────
    } catch (tratErr) {
      logger.warn(_CAT, `[TraT] Failed to build TraT context, continuing without it: ${tratErr.message}`);
      tratContextHeader = null;
    }

    emitDelegationAudit(userToken, exchangedToken, {
      scopes: effectiveToolScopes,
      audience: mcpResourceUri,
      exchangeMethod,
      userSub,
    });

    stampTokenEventsForUseCase(tokenEvents, activeUseCaseId);

    return { token: exchangedToken, tokenEvents, userSub, tratContextHeader };

  } catch (err) {
    // Replace in-progress with failure
    const inProgressIdx = tokenEvents.findIndex(e => e.id === 'exchange-in-progress');
    if (inProgressIdx !== -1) tokenEvents.splice(inProgressIdx, 1);

    // Build a human-readable summary from all available error detail
    const failParts = [
      `Exchange failed: ${err.message}`,
      err.httpStatus              ? `HTTP ${err.httpStatus}` : null,
      err.pingoneError            ? `error: ${err.pingoneError}` : null,
      err.pingoneErrorDescription && err.pingoneErrorDescription !== err.message
        ? `description: ${err.pingoneErrorDescription}` : null,
      err.pingoneErrorDetail      ? `detail: ${JSON.stringify(err.pingoneErrorDetail)}` : null,
    ].filter(Boolean).join(' — ');

    tokenEvents.push(buildTokenEvent(
      'exchange-failed',
      'Token Exchange (RFC 8693) — Failed',
      'failed',
      null,
      `${failParts}. Check that PingOne has the token-exchange grant enabled on this client and the audience policy allows ${mcpResourceUri}.`,
      {
        error: err.message,
        httpStatus: err.httpStatus,
        pingoneError: err.pingoneError,
        pingoneErrorDescription: err.pingoneErrorDescription,
        pingoneErrorDetail: err.pingoneErrorDetail,
        requestContext: err.requestContext,
        rfc: 'RFC 8693',
        trigger: toolTrigger,
        mayActPresent: !!userAccessTokenClaims?.may_act,
      }
    ));

    // RFC 8693 §5.2: Structured error code for audit log and operator diagnostics
    const { errorCode: rfc8693Code, errorDetails: rfc8693Details } = mapErrorToStructuredResponse(err);

    // Write failure to cross-Lambda Redis audit log (fire-and-forget)
    void writeExchangeEvent({
      type: 'exchange-failed',
      level: 'error',
      message: `[TokenExchange] Failed — error_code=${rfc8693Code} — ${failParts}`,
      error_code: rfc8693Code,
      oauth_error: rfc8693Details.oauth_error,
      http_status: rfc8693Details.http_status,
      category: rfc8693Details.category,
      httpStatus: err.httpStatus,
      pingoneError: err.pingoneError,
      pingoneErrorDescription: err.pingoneErrorDescription,
      pingoneErrorDetail: err.pingoneErrorDetail,
      requestContext: err.requestContext,
      mcpResourceUri,
      mayActPresent: !!userAccessTokenClaims?.may_act,
      rfc: 'RFC 8693',
    });

    // Attach the accumulated chain (incl. the exchange-failed event just pushed)
    // to the thrown error so callers can render WHERE the flow broke. Without this
    // the Token Chain goes blank exactly on an exchange failure — the one moment
    // the diagnostic view matters most. Mirrors the err.tokenEvents attachment at
    // the throwTokenResolutionError / user-token-invalid throw sites above.
    err.tokenEvents = tokenEvents;

    // D-04: Hard fail — no subject-only fallback when actor exchange fails.
    // A token without an act claim would be rejected by the banking API's requireDelegation check
    // anyway, so silently falling back produces a misleading flow. Surface the real error instead.
    throw err;
  }
}

// ─── Delegation provenance audit ─────────────────────────────────────────────────
// Writes a durable NDJSON record linking the subject token (T1) to the exchanged
// token (T2) by jti. This is the only place the T1↔T2 jti relationship is
// captured durably; the existing exchangeAuditStore is in-memory/ephemeral.
function emitDelegationAudit(userToken, exchangedToken, { scopes, audience, exchangeMethod, userSub }) {
  try {
    const t1Claims = decodeJwtClaims(userToken)?.claims;
    const t2Claims = decodeJwtClaims(exchangedToken)?.claims;
    writeMcpTrafficEntry({
      dir: 'BFF→Audit',
      type: 'delegation_provenance',
      method: 'rfc8693',
      tool: null,
      ok: true,
      summary: `T1↔T2 delegation linkage: t1_jti=${t1Claims?.jti || 'n/a'} → t2_jti=${t2Claims?.jti || 'n/a'} sub=${userSub || t2Claims?.sub || 'n/a'} act=${t2Claims?.act ? JSON.stringify(t2Claims.act) : 'absent'} aud=${audience} scopes="${(scopes || []).join(' ')}"`,
      payload: {
        t1_jti: t1Claims?.jti || null,
        t2_jti: t2Claims?.jti || null,
        sub: userSub || t2Claims?.sub || null,
        act: t2Claims?.act || null,
        audience,
        scopes: scopes || [],
        exchange_method: exchangeMethod,
      },
    });
  } catch (auditErr) {
    logger.warn(_CAT, `[DelegationAudit] Failed to write provenance record: ${auditErr.message}`);
  }
}
// ─────────────────────────────────────────────────────────────────────────────────

// ─── 2-Exchange delegation helper ──────────────────────────────────────────────────

/**
 * Perform the 2-exchange delegated chain:
 *   Step 1: AI Agent gets actor CC token (audience = AGENT_GATEWAY_AUDIENCE)
 *   Step 2: Exchange #1 — Subject Token + Agent Actor Token → Agent Exchanged Token
 *           exchanger = AI_AGENT_CLIENT_ID, audience = AI_AGENT_INTERMEDIATE_AUDIENCE
 *   Step 3: MCP Service gets actor CC token (audience = MCP_GATEWAY_AUDIENCE)
 *   Step 4: Exchange #2 — Agent Exchanged Token + MCP Actor Token → Final Token
 *           exchanger = AGENT_OAUTH_CLIENT_ID, audience = mcpResourceUri
 *   Result: Final Token has act.sub = MCP_CLIENT_ID, act.act.sub = AI_AGENT_CLIENT_ID
 */
// ─── Gateway bypass probe (Phase 253) ────────────────────────────────────────
// Determines the correct final audience for Exchange #2 based on whether the
// MCP Gateway is in bypass mode. Cached for 30 seconds to avoid per-request HTTP.

let _bypassCache = null; // { devBypass: boolean, ts: number } | null
const BYPASS_CACHE_TTL_MS = 30_000;
// BL-04: one-time warn when the dev-only insecure flag is honored.
let _warnedInsecureProbe = false;

/**
 * Resolve the final audience for Exchange #2 of the two-exchange delegation flow.
 * - Direct mode (no MCP_GATEWAY_HTTP_URL): always use mcp-server audience
 * - Gateway bypass mode (devBypass=true in /health): use mcp-server audience
 * - Gateway production mode (devBypass=false): use mcp-gateway audience (default)
 * - Gateway unreachable: fall back to mcp-server audience (safe fallback)
 *
 * @param {string} gatewayAud  - Production audience (mcp-gateway URI)
 * @param {string} mcpServerAud - Bypass/direct audience (mcp-server URI)
 * @returns {Promise<string>}
 */
async function _resolveFinalMcpAudience(gatewayAud, mcpServerAud) {
  // Direct mode: gateway not configured — always use mcp-server aud.
  // Use configStore.get() (not getEffective) so a FIELD_DEFS default doesn't
  // falsely trigger gateway mode when the gateway isn't deployed.
  //
  // ff_mcp_gateway_pinggateway: when on, route to PingGateway (mcp_pinggateway_url)
  // instead of the Node gateway (mcp_gateway_http_url).
  const usePingGateway = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
  const gatewayBaseUrl = usePingGateway
    ? (configStore.getEffective('mcp_pinggateway_url') || process.env.MCP_PINGGATEWAY_URL)
    : (process.env.MCP_GATEWAY_HTTP_URL || configStore.get('mcp_gateway_http_url'));
  if (!gatewayBaseUrl) {
    return mcpServerAud;
  }

  // Cache check
  const now = Date.now();
  if (_bypassCache && (now - _bypassCache.ts) < BYPASS_CACHE_TTL_MS) {
    return _bypassCache.devBypass ? mcpServerAud : gatewayAud;
  }

  // Probe /health
  const baseUrl = gatewayBaseUrl.replace(/\/$/, '');
  try {
    const healthResult = await new Promise((resolve, reject) => {
      const isHttps = baseUrl.startsWith('https://');
      const httpModule = isHttps ? require('https') : require('http');
      // BL-04: TLS verification on by default. The previous unconditional
      // `rejectUnauthorized: false` let a MITM on the BFF↔gateway path flip
      // this probe's perception of `devBypass`, downgrading audience selection
      // to direct-to-MCP-server (bypassing the gateway entirely).
      //
      // Dev escape hatch: only when explicitly opted in via
      // GATEWAY_HEALTH_PROBE_INSECURE=true AND NODE_ENV != 'production'.
      // Production hard-ignores the flag.
      const insecureFlag = configStore.getEffective('gateway_health_probe_insecure') === 'true';
      const isProd = process.env.NODE_ENV === 'production';
      const allowInsecure = insecureFlag && !isProd;
      if (allowInsecure && !_warnedInsecureProbe) {
        logger.warn(_CAT,
          '[TwoExchange] GATEWAY_HEALTH_PROBE_INSECURE=true and NODE_ENV is non-production — TLS verification on /health probe is DISABLED. Never set this flag in production.'
        );
        _warnedInsecureProbe = true;
      }
      // For local dev with mkcert: trust the mkcert CA root so the probe
      // validates the self-signed cert without skipping TLS entirely.
      let httpsOpts = {};
      if (isHttps) {
        if (allowInsecure) {
          httpsOpts = { rejectUnauthorized: false };
        } else {
          const mkcertCaPath = require('node:path').join(
            process.env.HOME || '',
            'Library', 'Application Support', 'mkcert', 'rootCA.pem',
          );
          const fs = require('node:fs');
          if (fs.existsSync(mkcertCaPath)) {
            httpsOpts = { ca: fs.readFileSync(mkcertCaPath) };
          }
        }
      }
      const req = httpModule.get(`${baseUrl}/health`, httpsOpts, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve({ ok: res.statusCode === 200, body: JSON.parse(data) }); }
          catch { resolve({ ok: false, body: {} }); }
        });
      });
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('gateway health probe timeout')); });
      req.on('error', reject);
    });
    const devBypass = !!(healthResult.ok && healthResult.body.devBypass);
    _bypassCache = { devBypass, ts: now };
    logger.info(_CAT, `[TwoExchange] Gateway health probe: devBypass=${devBypass} → finalAud=${devBypass ? mcpServerAud : gatewayAud}`);
    return devBypass ? mcpServerAud : gatewayAud;
  } catch (err) {
    // Gateway unreachable — check if bypass is explicitly allowed
    const allowBypass = configStore.get('ff_mcp_gateway_required') === 'false';
    if (!allowBypass) {
      // Gateway is required and health probe failed — fail closed
      logger.error(_CAT, `[TwoExchange] Gateway health probe failed (${err.message}) and MCP Gateway is required (ff_mcp_gateway_required defaults true).`);
      throw new Error(`MCP Gateway unavailable and bypass not permitted. ${err.message}`);
    }
    // Explicitly allowed to bypass gateway on error
    logger.warn(_CAT, `[TwoExchange] Gateway health probe failed (${err.message}) — bypassing gateway (ff_mcp_gateway_required=false)`);
    _bypassCache = { devBypass: true, ts: now };
    return mcpServerAud;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function _performTwoExchangeDelegation(
  tokenEvents, userToken, effectiveToolScopes, userSub, toolTrigger, mcpResourceUri, req
) {
  // ── RFC 8693 §2.1: Two-Exchange Delegation Configuration Validation
  let configResult;
  try {
    configResult = configStore.validateTwoExchangeConfig();
  } catch (configErr) {
    tokenEvents.push(buildTokenEvent(
      'two-exchange-config-invalid',
      '2-Exchange Configuration — Invalid',
      'failed', null, configErr.message,
      { rfc: 'RFC 8693 §2.1', code: configErr.code }
    ));
    throw configErr;
  }

  // Extract validated configuration - no hard-coded defaults
  const aiAgentClientId       = configResult.credentials.aiAgentClientId;
  const mcpExchangerClient    = configResult.credentials.mcpClientId;
  const agentGatewayAud       = configResult.audiences.agentGatewayAud;
  const intermediateAud       = configResult.audiences.intermediateAud;
  const mcpGatewayAud         = configResult.audiences.mcpGatewayAud;
  const mcpServerAudForFallback = configStore.getEffective('pingone_resource_mcp_server_uri') || process.env.PINGONE_RESOURCE_MCP_SERVER_URI || '';
  const twoExFinalAud         = await _resolveFinalMcpAudience(configResult.audiences.finalAud, mcpServerAudForFallback);
  const aiAgentClientSecret   = configStore.getEffective('pingone_ai_agent_client_secret') || process.env.PINGONE_AI_AGENT_CLIENT_SECRET || process.env.AI_AGENT_CLIENT_SECRET;
  const mcpExchangerSecret    = configStore.getEffective('pingone_mcp_token_exchanger_client_secret');
  // ARCHITECTURE TRUTH: all PingOne client connections use client_secret_post.
  // Only the Worker Token CC client (oauthService.getAgentClientCredentialsToken*)
  // stays 'basic'. These are non-worker (AI agent / MCP exchanger) → default 'post'.
  const aiAgentAuthMethod     = (configStore.get('ai_agent_token_endpoint_auth_method') || process.env.AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD || 'post').toLowerCase();
  const mcpExchangerAuthMethod = (configStore.get('mcp_exchanger_token_endpoint_auth_method') || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CC_AUTH_METHOD || process.env.PINGONE_MCP_TOKEN_EXCHANGER_AUTH_METHOD || process.env.MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD || 'post').toLowerCase();

  // ─ Step 1: AI Agent Actor Token (Client Credentials) ───────────────────────────
  tokenEvents.push(buildTokenEvent(
    'two-ex-agent-actor-acquiring',
    '2-Exchange #1 — AI Agent Actor Token (CC)',
    'acquiring',
    null,
    `AI Agent App (${aiAgentClientId}) getting Client Credentials actor token. ` +
      `Audience: ${agentGatewayAud} (Super Banking Agent Gateway).`,
    { rfc: 'RFC 8693 §2.1 (actor_token)', exchangeStep: '1-actor' }
  ));

  let agentActorToken;
  try {
    // RFC 8707: the AI Agent app is granted scopes on two resources (Agent
    // Gateway + Two-Exchange Intermediate). PingOne rejects a CC request that
    // has `audience` but no `scope` with `invalid_scope: "May not request
    // scopes for multiple resources"`. Name the single Agent-Gateway scope
    // explicitly so PingOne narrows to one resource. Default matches the
    // provisioner grant (pingoneProvisionService.js Step 37a: agent:invoke).
    const agentGatewayScope = configStore.getEffective('agent_gateway_cc_scope') || 'agent:invoke';
    agentActorToken = await oauthService.getClientCredentialsTokenAs(aiAgentClientId, aiAgentClientSecret, agentGatewayAud, aiAgentAuthMethod, agentGatewayScope);
    const agentActorDecoded = decodeJwtClaims(agentActorToken);
    const actorIdx = tokenEvents.findIndex(e => e.id === 'two-ex-agent-actor-acquiring');
    if (actorIdx !== -1) tokenEvents.splice(actorIdx, 1);
    tokenEvents.push(buildTokenEvent(
      'two-ex-agent-actor',
      '2-Exchange #1 — AI Agent Actor Token (CC) ✔️',
      'active',
      agentActorDecoded,
      `AI Agent App (${aiAgentClientId}) obtained its Client Credentials actor token. ` +
        `aud=${agentGatewayAud}. Used as actor_token in Exchange #1.`,
      { rfc: 'RFC 8693 §2.1', exchangeStep: '1-actor' }
    ));
      // JWKS verify the AI Agent actor CC token
      await pushJwksVerifyEvent(agentActorToken, tokenEvents, 'two-ex-agent-actor-verified', 'AI Agent Actor Token (CC)');
  } catch (err) {
    const actorIdx = tokenEvents.findIndex(e => e.id === 'two-ex-agent-actor-acquiring');
    if (actorIdx !== -1) tokenEvents.splice(actorIdx, 1);
    tokenEvents.push(buildTokenEvent(
      'two-ex-agent-actor',
      '2-Exchange #1 — AI Agent Actor Token ❌',
      'failed',
      null,
      `AI Agent client credentials failed: ${err.message}.
      Remediation steps:
      1. Verify configStore has 'ai_agent_client_id' OR PINGONE_AI_AGENT_CLIENT_ID env var is set
      2. Verify PINGONE_AI_AGENT_CLIENT_SECRET OR AI_AGENT_CLIENT_SECRET env var is set
      3. Check PingOne Admin → Applications → Super Banking AI Agent → OAuth settings
      4. Verify Client Credentials grant is enabled on the OAuth app
      5. If recently modified, restart the server for env changes to take effect`,
      { error: err.message, exchangeStep: '1-actor' }
    ));
    throw createTokenExchangeError('actor_token_invalid', {
      exchangeType: 'double',
      exchangeStep: '1-actor',
      actorPresent: false,
      audience: agentGatewayAud,
      originalError: err
    }, err);
  }

  // ─ Step 2: Exchange #1 — Subject Token + Agent Actor Token → Agent Exchanged Token ─────
  // RFC 8707 single-resource rule: all scopes requested here must belong to the
  // intermediateAud (agentgateway.ping.demo) resource. The Agent Gateway resource
  // carries both its native agent:invoke scope AND mirroredScopes (read, write,
  // transfer, etc.) — so requesting effectiveToolScopes here is valid and single-resource.
  // This populates the intermediate token with the tool scopes that PingOne needs
  // to see in the Exchange #2 subject token before it will output them in the final token.
  // The agent:invoke scope is always included so the actor CC token selection stays
  // unambiguous (agent_gateway_cc_scope default).
  const intermediateExchangeScope =
    configStore.getEffective('two_exchange_intermediate_scope') || 'agent:invoke';
  // Exchange #1 targets agentgateway.ping.demo. Only request scopes that exist on
  // that resource (native + mirroredScopes) so PingOne doesn't see a multi-resource
  // request. mcp:invoke lives on mcpgateway.ping.demo and must be excluded here.
  const agentGwScopesAllowed = new Set(scopeTopology.resourceScopes('Super Banking Agent Gateway'));
  const exchange1ToolScopes = effectiveToolScopes.filter(s => agentGwScopesAllowed.has(s));
  const exchange1ScopeSet = new Set([intermediateExchangeScope, ...exchange1ToolScopes]);
  const exchange1Scopes = [...exchange1ScopeSet];
  tokenEvents.push(buildTokenEvent(
    'two-ex-exchange1-in-progress',
    '2-Exchange #1 — Subject Token → Agent Exchanged Token',
    'acquiring',
    null,
    `Exchange #1 (RFC 8693): exchanger=${aiAgentClientId}, ` +
      `subject=Subject Token (may_act.sub must equal actor_token.aud[0]=${aiAgentClientId}), ` +
      `audience=${intermediateAud}, scope="${exchange1Scopes.join(' ')}" ` +
      `(agent:invoke + tool scopes mirrored on Agent Gateway; carried into intermediate token for Exchange #2 narrowing).`,
    { rfc: 'RFC 8693', exchangeStep: '1-exchange',
      exchangeRequest: { exchanger: aiAgentClientId, audience: intermediateAud, scope: exchange1Scopes.join(' ') } }
  ));

  let agentExchangedToken;
  try {
    // RFC 8707: wrap intermediateAud in an array so applyAudienceParam emits
    // `resource=` instead of `audience=`. PingOne token-exchange (RFC 8693)
    // requires the RFC 8707 `resource` parameter to narrow to one RS when the
    // client has grants on multiple resource servers; `audience=` alone is
    // silently ignored and PingOne returns "May not request scopes for
    // multiple resources".
    agentExchangedToken = await oauthService.performTokenExchangeAs(
      userToken, agentActorToken, aiAgentClientId, aiAgentClientSecret, [intermediateAud], exchange1Scopes, aiAgentAuthMethod
    );
    const agentExchangedDecoded = decodeJwtClaims(agentExchangedToken);
    const agentExchangedClaims = agentExchangedDecoded?.claims;
    const ex1Idx = tokenEvents.findIndex(e => e.id === 'two-ex-exchange1-in-progress');
    if (ex1Idx !== -1) tokenEvents.splice(ex1Idx, 1);
    tokenEvents.push(buildTokenEvent(
      'two-ex-exchange1',
      '2-Exchange #1 — Agent Exchanged Token ✔️',
      'exchanged',
      agentExchangedDecoded,
      `Exchange #1 succeeded. Agent Exchanged Token (Token 2): aud=${JSON.stringify(agentExchangedClaims?.aud)}` +
        (agentExchangedClaims?.act ? `, act=${JSON.stringify(agentExchangedClaims.act)}` : '') + '. ' +
        'Now performing Exchange #2.',
      { rfc: 'RFC 8693', exchangeStep: '1-exchange',
        actPresent: !!agentExchangedClaims?.act,
        actExpectedHere: false,
        actDetails: agentExchangedClaims?.act ? JSON.stringify(agentExchangedClaims.act) : null }
    ));
    // JWKS verify the agent exchanged token (result of Exchange #1)
    await pushJwksVerifyEvent(agentExchangedToken, tokenEvents, 'two-ex-exchange1-verified', 'Agent Exchanged Token (#1 result)');
  } catch (err) {
    const ex1Idx = tokenEvents.findIndex(e => e.id === 'two-ex-exchange1-in-progress');
    if (ex1Idx !== -1) tokenEvents.splice(ex1Idx, 1);
    tokenEvents.push(buildTokenEvent(
      'two-ex-exchange1',
      '2-Exchange #1 — Subject Token exchange failed ❌',
      'failed',
      null,
      `Exchange #1 failed: ${err.message}.`,
      { error: err.message, httpStatus: err.httpStatus, pingoneError: err.pingoneError,
        pingoneErrorDescription: err.pingoneErrorDescription, exchangeStep: '1-exchange' }
    ));
    const { errorCode: ex1Code, errorDetails: ex1Details } = mapErrorToStructuredResponse(err);
    void writeExchangeEvent({ type: 'exchange-failed', level: 'error',
      message: `[2-Exchange#1] Failed — error_code=${ex1Code} — ${err.message}`,
      error_code: ex1Code, oauth_error: ex1Details.oauth_error, http_status: ex1Details.http_status,
      category: ex1Details.category, exchangeStep: '1', pingoneError: err.pingoneError });
    throw createTokenExchangeError('invalid_grant', {
      exchangeType: 'double',
      exchangeStep: '1-exchange',
      actorPresent: true,
      audience: intermediateAud,
      scopes: effectiveToolScopes,
      originalError: err
    }, err);
  }

  // ─ Step 3: MCP Actor Token (Client Credentials) ──────────────────────────────
  tokenEvents.push(buildTokenEvent(
    'two-ex-mcp-actor-acquiring',
    '2-Exchange #2 — MCP Actor Token (CC)',
    'acquiring',
    null,
    `MCP Service App (${mcpExchangerClient}) getting Client Credentials actor token. ` +
      `Audience: ${mcpGatewayAud} (Super Banking MCP Gateway).`,
    { rfc: 'RFC 8693 §2.1 (actor_token)', exchangeStep: '2-actor' }
  ));

  let mcpActorToken;
  try {
    // RFC 8707: the MCP Exchanger app is granted scopes on multiple resources
    // (MCP Gateway + Two-Exchange Final + MCP Server). Same multi-resource
    // invalid_scope trap as the AI Agent actor token above — name the single
    // MCP-Gateway scope explicitly. Default matches the provisioner grant
    // (pingoneProvisionService.js Step 37b: mcp:invoke).
    const mcpGatewayScope = configStore.getEffective('mcp_gateway_cc_scope') || 'mcp:invoke';
    mcpActorToken = await oauthService.getClientCredentialsTokenAs(mcpExchangerClient, mcpExchangerSecret, mcpGatewayAud, mcpExchangerAuthMethod, mcpGatewayScope);
    const mcpActorDecoded = decodeJwtClaims(mcpActorToken);
    const mcpActorIdx = tokenEvents.findIndex(e => e.id === 'two-ex-mcp-actor-acquiring');
    if (mcpActorIdx !== -1) tokenEvents.splice(mcpActorIdx, 1);
    tokenEvents.push(buildTokenEvent(
      'two-ex-mcp-actor',
      '2-Exchange #2 — MCP Actor Token (CC) ✔️',
      'active',
      mcpActorDecoded,
      `MCP Service App (${mcpExchangerClient}) obtained its Client Credentials actor token. ` +
        `aud=${mcpGatewayAud}. Used as actor_token in Exchange #2.`,
      { rfc: 'RFC 8693 §2.1', exchangeStep: '2-actor' }
    ));
      // JWKS verify the MCP Service actor CC token
      await pushJwksVerifyEvent(mcpActorToken, tokenEvents, 'two-ex-mcp-actor-verified', 'MCP Service Actor Token (CC)');
  } catch (err) {
    const mcpActorIdx = tokenEvents.findIndex(e => e.id === 'two-ex-mcp-actor-acquiring');
    if (mcpActorIdx !== -1) tokenEvents.splice(mcpActorIdx, 1);
    tokenEvents.push(buildTokenEvent(
      'two-ex-mcp-actor',
      '2-Exchange #2 — MCP Actor Token ❌',
      'failed',
      null,
      `MCP Service client credentials failed: ${err.message}.
      Remediation steps:
      1. Verify configStore has 'mcp_oauth_client_id' OR AGENT_OAUTH_CLIENT_ID env var is set
      2. Verify AGENT_OAUTH_CLIENT_SECRET env var is set
      3. Check PingOne Admin → Applications → MCP Token Exchanger → OAuth settings
      4. Verify Client Credentials grant is enabled and correct audience (${mcpGatewayAud}) is configured
      5. Ensure MCP_GATEWAY_AUDIENCE env var is set correctly
      6. Restart server if recently modified`,
      { error: err.message, exchangeStep: '2-actor' }
    ));
    throw createTokenExchangeError('actor_token_invalid', {
      exchangeType: 'double',
      exchangeStep: '2-actor',
      actorPresent: false,
      audience: mcpGatewayAud,
      originalError: err
    }, err);
  }

  // ─ Step 4: Exchange #2 — Agent Exchanged Token + MCP Actor Token → Final Token ────
  // RFC 8707: include the MCP gateway audience (and optionally the server audience) in the
  // resource indicators. PingOne token exchange does not support requesting scopes across
  // multiple resource grants in a single exchange (returns invalid_scope), so the MCP server
  // must validate the gateway aud (MCP_SERVER_RESOURCE_URI=mcpgateway.ping.demo) rather than
  // a separate server-specific aud. The server aud param is kept as a no-op when no server
  // grant exists — PingOne silently ignores resources with no matching grant.
  //
  // PingGateway exception: when routing through PingGateway, request ONLY the gateway audience.
  // PingGateway performs its own second exchange to mcpserver.ping.demo internally; passing both
  // as RFC 8707 resource params causes PingOne to issue a multi-resource token that PingGateway's
  // introspection rejects as inactive (active: false).
  // PingGateway also requires the token aud to be an HTTPS URL matching McpProtectionFilter.resourceId
  // (bare audience strings like mcpgateway.ping.demo are rejected with URI scheme null error).
  // ff_gateway_brokered_exchange (default true) decouples WHO performs the final
  // RFC 8693 hop from routing. Gateway-brokered (default): the BFF stops at the
  // coarse gateway audience and the IG runs olb-token-exchange.groovy to mint the
  // mcpserver.ping.demo token at the edge. BFF-brokered (flag false): the BFF
  // completes the exchange to the mcp-server audience itself and the IG skips its
  // exchange (signaled by X-BFF-Exchanged; see mcpGatewayClient). Only meaningful
  // when routing through PingGateway; unset/true preserves today's behavior exactly.
  const routeViaPingGateway = configStore.getEffective('ff_mcp_gateway_pinggateway') === 'true';
  const gatewayBrokeredExchange = configStore.getEffective('ff_gateway_brokered_exchange') !== 'false';
  const usePingGatewayForExchange = routeViaPingGateway && gatewayBrokeredExchange;
  const pingGatewayResourceAud = usePingGatewayForExchange
    ? (process.env.PINGONE_RESOURCE_PINGGATEWAY_URI || configStore.getEffective('pingone_resource_pinggateway_uri') || twoExFinalAud)
    : null;
  const finalAudTarget = pingGatewayResourceAud || twoExFinalAud;
  const finalAudiences = !usePingGatewayForExchange && mcpServerAudForFallback && mcpServerAudForFallback !== twoExFinalAud
    ? [twoExFinalAud, mcpServerAudForFallback]
    : finalAudTarget;
  const finalAudDisplay = Array.isArray(finalAudiences) ? JSON.stringify(finalAudiences) : finalAudiences;

  tokenEvents.push(buildTokenEvent(
    'two-ex-exchange2-in-progress',
    '2-Exchange #2 — Agent Exchanged Token → Final MCP Token',
    'acquiring',
    null,
    `Exchange #2 (RFC 8693): exchanger=${mcpExchangerClient}, ` +
      `subject=Agent Exchanged Token (act.sub must equal actor_token.aud[0]=${mcpExchangerClient}), ` +
      `audience=${finalAudDisplay} (RFC 8707 multi-resource). act expression forwards act.sub from Agent Exchanged Token.`,
    { rfc: 'RFC 8693 + RFC 8707', exchangeStep: '2-exchange',
      exchangeRequest: { exchanger: mcpExchangerClient, audience: finalAudDisplay, scope: effectiveToolScopes.join(' ') } }
  ));

  let finalToken;
  try {
    // When routing through PingGateway, request a single coarse scope on the
    // PingGateway MCP resource (https://api.ping.demo:3036/mcp). PingGateway itself
    // requires only a valid bearer + RFC 8707 audience match + a configurable coarse
    // scope — NOT a product-specific scope name. The name here is unique
    // (gateway:mcp:invoke, the mcp:invoke capability on the gateway hop) only because
    // PingOne forbids one exchanger app from holding the same scope name on two
    // resources — an AS grant-model constraint, not a PingGateway requirement.
    // (Sending effectiveToolScopes made PingOne fall back to the mcpgateway grant;
    // empty scopes error "May not request scopes for multiple resources".)
    // Renamed key (was pinggateway_invoke_scope); honor an operator override
    // persisted under the old key so upgrades don't silently drop it.
    const gatewayInvokeScope = configStore.getEffective('gateway_mcp_invoke_scope')
      || configStore.getEffective('pinggateway_invoke_scope')
      || 'gateway:mcp:invoke';
    const ex2Scopes = usePingGatewayForExchange ? [gatewayInvokeScope] : effectiveToolScopes;
    finalToken = await oauthService.performTokenExchangeAs(
      agentExchangedToken, mcpActorToken, mcpExchangerClient, mcpExchangerSecret, finalAudiences, ex2Scopes, mcpExchangerAuthMethod
    );
    const finalDecoded = decodeJwtClaims(finalToken);
    const finalClaims  = finalDecoded?.claims;
    const ex2Idx = tokenEvents.findIndex(e => e.id === 'two-ex-exchange2-in-progress');
    if (ex2Idx !== -1) tokenEvents.splice(ex2Idx, 1);
    const mcpTokenAud = finalClaims?.aud;
    const audMatches  = mcpTokenAud === finalAudTarget || (Array.isArray(mcpTokenAud) && mcpTokenAud.includes(finalAudTarget));
    const nestedActOk = !!finalClaims?.act?.sub && !!finalClaims?.act?.act?.sub;
    tokenEvents.push(buildTokenEvent(
      'two-ex-final-token',
      '2-Exchange: Final MCP Token (nested act chain) ✔️',
      'exchanged',
      finalDecoded,
      'Both RFC 8693 exchanges succeeded. Final MCP Token (Token 3): ' +
        `aud=${JSON.stringify(mcpTokenAud)}${audMatches ? ' ✅' : ' ❌ mismatch'}. ` +
        (nestedActOk
          ? `act.sub=${finalClaims.act.sub} (MCP Service), act.act.sub=${finalClaims.act.act.sub} (AI Agent). ` +
            'Full delegation chain verified. PAZ can enforce both act.sub and act.act.sub as named policy attributes.'
          : finalClaims?.act?.sub
            ? `act.sub=${finalClaims.act.sub} (AI Agent identity preserved). ` +
              'PingOne SpEL cannot construct fully-nested act objects — act.sub reflects the AI Agent as delegation initiator. ' +
              'PAZ can enforce act.sub as a policy attribute. See docs/PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md §1e.'
            : 'act claim missing from Final Token — add the act expression to the Super Banking Resource Server to record the delegation chain (docs/PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md §1e).'),
      { rfc: 'RFC 8693', exchangeStep: '2-exchange', exchangeMethod: '2-exchange',
        actPresent: !!finalClaims?.act,
        actDetails: finalClaims?.act ? JSON.stringify(finalClaims.act) : null,
        nestedActPresent: nestedActOk,
        audienceNarrowed: finalAudTarget, audMatches,
        audExpected: finalAudTarget, audActual: mcpTokenAud,
        scopeNarrowed: effectiveToolScopes.join(' ') }
    ));
    // JWKS verify the final MCP token (result of Exchange #2)
    await pushJwksVerifyEvent(finalToken, tokenEvents, 'two-ex-final-token-verified', 'Final MCP Token (#2 result)');

    void writeExchangeEvent({
      type: 'exchange-success', level: 'info',
      message: `[2-Exchange] Final token issued — audience=${mcpResourceUri} act=${!!finalClaims?.act} nestedAct=${nestedActOk}`,
      exchangeMethod: '2-exchange', mcpResourceUri,
      actPresent: !!finalClaims?.act, nestedActPresent: nestedActOk, audMatches,
    });

    // ── TraT Mode: attach Transaction Token context for intra-domain propagation ──
    let twoExTratContextHeader = null;
    try {
      const _tratRaw = configStore.getEffective('ff_trat_mode');
      const ffTratMode = _tratRaw === true || _tratRaw === 'true';
      const { ffDpop, ffRar, extras } = _buildAgenticExtras(req || {}, toolTrigger, userSub, tokenEvents);
      if ((ffTratMode || ffDpop || ffRar) && finalToken) {
        const agentClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || '';
        const gatewayClientId = configStore.getEffective('pingone_ai_agent_client_id') || process.env.PINGONE_AI_AGENT_CLIENT_ID || '';
        const tratCtx = buildTratContext(req || {}, toolTrigger, userSub, agentClientId, gatewayClientId, extras);
        const finalDecoded2 = decodeJwtClaims(finalToken);
        const hasNativeReqctx = !!(finalDecoded2?.claims?.reqctx);
        const isSim = !hasNativeReqctx;
        // Carry the envelope whenever TraT is simulated OR it carries DPoP cnf.jkt / RAR
        // authorization_details (see single-exchange path) so cnf is never dropped.
        if (isSim || extras.cnfJkt || extras.rarDetails) twoExTratContextHeader = JSON.stringify({ ...tratCtx, trat_sim: isSim });
        tokenEvents.push(buildTokenEvent(
          'trat-context',
          isSim ? 'Transaction Token (TraT) — Simulation Mode' : 'Transaction Token (TraT) — PingOne Native',
          isSim ? 'active' : 'success',
          null,
          isSim
            ? 'ff_trat_mode is ON. TraT context forwarded alongside MCP token as X-TraT-Context header for intra-domain propagation. trat_sim: true marks simulation.'
            : 'ff_trat_mode is ON. PingOne emitted reqctx natively — no simulation header needed.',
          { rfc: 'draft-oauth-transaction-tokens-for-agents-00', tratContext: { reqctx: tratCtx.reqctx, purp: tratCtx.purp, azd: tratCtx.azd, rctx: tratCtx.rctx }, trat_sim: isSim, nativeClaims: !isSim }
        ));
      }
    } catch (tratErr) {
      logger.warn(_CAT, `[TraT] Failed to build TraT context in 2-exchange path: ${tratErr.message}`);
    }

    emitDelegationAudit(userToken, finalToken, {
      scopes: effectiveToolScopes,
      audience: mcpResourceUri,
      exchangeMethod: '2-exchange',
      userSub,
    });

    return { token: finalToken, tokenEvents, userSub, tratContextHeader: twoExTratContextHeader };

  } catch (err) {
    const ex2Idx = tokenEvents.findIndex(e => e.id === 'two-ex-exchange2-in-progress');
    if (ex2Idx !== -1) tokenEvents.splice(ex2Idx, 1);
    tokenEvents.push(buildTokenEvent(
      'two-ex-final-token',
      '2-Exchange #2 — Final exchange failed ❌',
      'failed',
      null,
      `Exchange #2 failed: ${err.message}. ` +
        'Check that act.sub on the Agent Exchanged Token matches AGENT_OAUTH_CLIENT_ID ' +
        'and that the act expression on Super Banking MCP Server resource server is correct.',
      { error: err.message, httpStatus: err.httpStatus, pingoneError: err.pingoneError,
        pingoneErrorDescription: err.pingoneErrorDescription, exchangeStep: '2-exchange' }
    ));
    const { errorCode: ex2Code, errorDetails: ex2Details } = mapErrorToStructuredResponse(err);
    void writeExchangeEvent({ type: 'exchange-failed', level: 'error',
      message: `[2-Exchange#2] Failed — error_code=${ex2Code} — ${err.message}`,
      error_code: ex2Code, oauth_error: ex2Details.oauth_error, http_status: ex2Details.http_status,
      category: ex2Details.category, pingoneError: err.pingoneError });
    throw createTokenExchangeError('delegation_chain_broken', {
      exchangeType: 'double',
      exchangeStep: '2-exchange',
      actorPresent: true,
      audience: finalAudTarget,
      scopes: effectiveToolScopes,
      originalError: err
    }, err);
  }
}

/**
 * Legacy resolver — returns only the token (backwards compat with existing callers).
 */
async function resolveMcpAccessToken(req, tool) {
  const { token } = await resolveMcpAccessTokenWithEvents(req, tool);
  return token;
}

module.exports = {
  resolveMcpAccessToken,
  resolveMcpAccessTokenWithEvents,
  buildSessionPreviewTokenEvents,
  decodeJwtClaims,
  buildTokenEvent,
  buildRefreshTokenEvent,
  prependRefreshEvent,
  sanitizeClaims,
  countJwtScopes,
  MIN_USER_SCOPES_FOR_MCP,
  buildTratContext,
  buildRarAuthorizationDetails,
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 56-05 Enhancement: Structured Error Code Responses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map error context to RFC 8693 standardized error code.
 * Uses ERROR_CODES from configStore to provide structured error information.
 *
 * @param {Error|string} error - Error object or message
 * @param {object} context - Additional error context (pingoneError, etc.)
 * @returns {object} {errorCode: string, errorDetails: object, message: string}
 */
function mapErrorToStructuredResponse(error, context = {}) {
  const errorMessage = (error?.message || error?.pingoneError || String(error) || 'Unknown error').toLowerCase();
  
  let errorCode = 'server_error'; // Default
  
  // Map common error patterns to RFC 8693 codes
  if (errorMessage.includes('invalid_client') || errorMessage.includes('client_id')) {
    errorCode = 'invalid_client';
  } else if (errorMessage.includes('invalid_grant') || errorMessage.includes('grant')) {
    errorCode = 'invalid_grant';
  } else if (errorMessage.includes('invalid_scope') || errorMessage.includes('scope')) {
    errorCode = 'invalid_scope';
  } else if (errorMessage.includes('unauthorized') || errorMessage.includes('not authorized')) {
    errorCode = 'unauthorized_client';
  } else if (errorMessage.includes('token_expired') || errorMessage.includes('expired')) {
    errorCode = 'token_expired';
  } else if (errorMessage.includes('invalid_token')) {
    errorCode = 'invalid_token';
  } else if (errorMessage.includes('may_act')) {
    errorCode = 'may_act_validation_failed';
  } else if (errorMessage.includes('subject')) {
    errorCode = 'subject_mismatch';
  } else if (errorMessage.includes('access_denied')) {
    errorCode = 'access_denied';
  } else if (errorMessage.includes('insufficient_scope')) {
    errorCode = 'insufficient_scope';
  }
  
  // Get error details from configStore (already imported at top of file)
  const errorDetails = configStore.getErrorDetails(errorCode);
  
  return {
    errorCode,
    errorDetails,
    message: error?.message || error?.pingoneErrorDescription || 'Token exchange failed',
  };
}

module.exports.mapErrorToStructuredResponse = mapErrorToStructuredResponse;
