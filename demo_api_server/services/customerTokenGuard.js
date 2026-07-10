// demo_api_server/services/customerTokenGuard.js
/**
 * Guard: the customer AI agent must never run a customer banking tool with an
 * ADMIN-CLIENT access token. An admin-client token (azp/client_id === the admin
 * client) cannot read customer banking data, so `get_my_accounts` & friends
 * return wrong-identity results and the reason loop keeps retrying — the "show
 * my accounts loop" reported on the customer page while holding an admin token.
 *
 * Instead we fail fast: the agent does zero tool calls and returns a structured
 * `requiresCustomerLogin` envelope so the SPA can offer "Log in as customer" vs
 * "Cancel (stay on admin)". Force the user to obtain a real user token.
 *
 * Detection mirrors middleware/auth.js `isAdminClient` (azp/client_id vs
 * admin_client_id) so it works even when only the raw token is available
 * (executeBffTool runs with a mock req).
 */
'use strict';

const oauthConfig = require('../config/oauth');

/**
 * Customer-facing banking tools that require a user token. Admin/agent-only or
 * vertical plugin tools are not gated here.
 */
const CUSTOMER_BANKING_TOOLS = new Set([
  'get_my_accounts',
  'get_account_balance',
  'get_my_transactions',
  'get_sensitive_account_details',
  'create_transfer',
  'create_deposit',
  'create_withdrawal',
]);

/** Decode JWT claims without signature verification (read-only inspection). */
function _decodeJwtClaims(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64').toString());
  } catch (_) {
    return null;
  }
}

/**
 * True when `userToken` was issued to the admin client (azp/client_id ===
 * admin_client_id). Such a token must never drive a customer banking tool.
 * @param {string} userToken
 * @returns {boolean}
 */
function isAdminClientToken(userToken) {
  const adminClientId = String(oauthConfig.clientId || '').trim();
  if (!adminClientId) return false;
  const claims = _decodeJwtClaims(userToken);
  if (!claims) return false;
  const tokenClientId = claims.azp || claims.client_id;
  return !!tokenClientId && tokenClientId === adminClientId;
}

/** Is this tool a customer-facing banking tool that requires a user token? */
function isCustomerBankingTool(name) {
  return CUSTOMER_BANKING_TOOLS.has(name);
}

/**
 * Verticals whose agent must NOT be blocked by the admin-token guard, because
 * an admin token is the CORRECT credential for them:
 *  - `admin` — the admin console: its chips (lookup_customer, freeze_account,
 *    …) are admin-only tools, so an admin token is required, not customer login.
 *  - `oauth-teaching` — OAuth Academy: pure teaching surface whose explain/show
 *    tools never read customer banking data (the one money-moving demo tool
 *    stays protected by the per-tool guard in bffMcpToolExecutor).
 * Customer verticals (banking, healthcare, …) are NOT exempt: an admin token
 * there returns wrong-identity data and must trigger customer sign-in.
 */
const ADMIN_TOKEN_GUARD_EXEMPT_VERTICALS = new Set(['admin', 'oauth-teaching']);

function isVerticalExemptFromAdminTokenGuard(vertical) {
  return ADMIN_TOKEN_GUARD_EXEMPT_VERTICALS.has(vertical);
}

/**
 * Canonical terminal envelope. `terminal: true` stops the reason loop (no
 * retry); `requiresCustomerLogin: true` tells the SPA to render the
 * login-as-customer / cancel action card.
 */
const ADMIN_TOKEN_ON_CUSTOMER = Object.freeze({
  error: 'admin_token_on_customer',
  code: 'admin_token_on_customer',
  requiresCustomerLogin: true,
  terminal: true,
  message:
    'This action needs a customer sign-in. You are signed in with an admin token, ' +
    'which cannot read customer banking data. Log in as a customer to continue, ' +
    'or cancel to stay on the admin console.',
});

/** Build the agent-response envelope returned when an admin token hits the customer agent. */
function adminTokenAgentResponse(tokenEvents = []) {
  return {
    reply: ADMIN_TOKEN_ON_CUSTOMER.message,
    success: false,
    toolsCalled: [],
    tokensUsed: 0,
    requiresConsent: false,
    requiresCustomerLogin: true,
    code: 'admin_token_on_customer',
    error: 'admin_token_on_customer',
    agentConfigured: true,
    tokenEvents: tokenEvents || [],
  };
}

module.exports = {
  isAdminClientToken,
  isCustomerBankingTool,
  isVerticalExemptFromAdminTokenGuard,
  ADMIN_TOKEN_GUARD_EXEMPT_VERTICALS,
  CUSTOMER_BANKING_TOOLS,
  ADMIN_TOKEN_ON_CUSTOMER,
  adminTokenAgentResponse,
};
