/**
 * errorMessageBuilder.js
 *
 * Builds educational error message content for each of 8 security error categories.
 * Each method returns { what_failed, why, teaching, fix } objects.
 *
 * Phase 156: Improve security error messages
 */

function describeActChainShape() {
  return 'RFC 8693 delegation chains use act.sub for the current actor and nest prior actors under act.act.sub when PingOne preserves the full chain.';
}

/**
 * Token type mismatch — user token used where agent token required (or vice versa)
 *
 * @param {string} required - Required token type (e.g. 'agent')
 * @param {string} actual - Actual token type (e.g. 'user')
 * @param {string[]} scopes - Token scopes
 * @returns {object} { what_failed, why, teaching, fix, tokens_involved }
 */
function buildTokenTypeMismatch(required, actual, scopes) {
  return {
    what_failed: `Token type validation failed. Expected '${required}' token, received '${actual}' token.`,
    why: `This endpoint requires a '${required}' token for security isolation. User tokens are associated with a person and grant personal access. Agent tokens are issued to AI systems via Client Credentials or Token Exchange. Each type carries different permissions and audit trails.`,
    teaching: 'User tokens and agent tokens have different permission boundaries to prevent privilege escalation. A user token cannot act as an agent, and an agent token cannot impersonate a user without explicit delegation (RFC 8693 Token Exchange).',
    fix: required === 'agent'
      ? 'Use agent authentication (OAuth 2.0 Client Credentials grant) to obtain an agent token, or use Token Exchange to get a delegated agent token.'
      : 'Use the standard login flow (Authorization Code + PKCE) to obtain a user token.',
    tokens_involved: {
      token_type: actual,
      required_type: required,
      token_scopes: scopes || [],
    },
  };
}

/**
 * Scope violation — token missing required scopes
 *
 * @param {string[]} required - Required scopes
 * @param {string[]} actual - Actual token scopes
 * @returns {object}
 */
function buildScopeViolation(required, actual) {
  const missing = (required || []).filter(r => !(actual || []).includes(r));
  return {
    what_failed: `Scope validation failed. Required: [${(required || []).join(', ')}]. Present: [${(actual || []).join(', ')}]. Missing: [${missing.join(', ')}].`,
    why: `This endpoint requires specific OAuth scopes. Scopes limit what each token can do — even if the identity has broader permissions. Missing scopes: ${missing.join(', ')}.`,
    teaching: 'Scopes implement the principle of least privilege at the token level. Each token is issued with only the permissions needed for its purpose. Even an admin user\'s token may lack certain scopes if they weren\'t requested during authentication.',
    fix: `Request the missing scope(s) [${missing.join(', ')}] during authentication. For Client Credentials, add them to the scope parameter. For Authorization Code, include them in the authorize request.`,
    tokens_involved: {
      token_scopes: actual || [],
      required_scopes: required || [],
      missing_scopes: missing,
    },
  };
}

/**
 * Audience mismatch — token issued for a different API
 *
 * @param {string} tokenAud - Token's audience claim
 * @param {string} expectedAud - Expected audience for this endpoint
 * @returns {object}
 */
function buildAudienceMismatch(tokenAud, expectedAud) {
  return {
    what_failed: `Token audience mismatch. Token issued for: '${tokenAud}'. This endpoint expects: '${expectedAud}'.`,
    why: 'Tokens are bound to a specific audience (the \'aud\' claim). This prevents a token stolen from one API from being replayed against another API. This is called audience binding.',
    teaching: 'Audience binding is a core OAuth 2.0 security mechanism. Even if an attacker intercepts a valid token, they cannot reuse it on a different API because the audience claim won\'t match.',
    fix: `Obtain a new token from the authorization server with the correct audience value: '${expectedAud}'.`,
    tokens_involved: {
      token_aud: tokenAud,
      expected_aud: expectedAud,
    },
  };
}

/**
 * Delegation claim missing — agent lacks 'act' claim for on-behalf-of operations
 *
 * @param {object} context - { endpoint, method }
 * @returns {object}
 */
function buildDelegationClaimMissing(context) {
  return {
    what_failed: `Delegation claim ('act') missing from token. Endpoint ${context.method || 'unknown'} ${context.endpoint || 'unknown'} requires a verifiable delegation chain.`,
    why: 'For AI agents to act on behalf of users, the exchanged token must contain an RFC 8693 act claim proving that delegation was authorized. Without it, the server cannot distinguish a valid on-behalf-of chain from an untrusted direct call.',
    teaching: 'The act claim is a signed chain-of-custody. In the simple path, act.sub identifies the current actor. In the full 2-exchange path, prior actors can be nested under act.act.sub. Missing act means the chain never started.',
    fix: 'Use RFC 8693 token exchange to obtain a delegated token before calling this endpoint. For 1-exchange, expect act.sub for the current exchanger. For the full 2-exchange path, PingOne may preserve a nested chain such as act.sub=<MCP service> and act.act.sub=<AI agent>.',
    tokens_involved: {
      endpoint: context.endpoint,
      method: context.method,
      act_claim: 'missing',
      expected_claim_shape: 'act.sub (current actor), optional act.act.sub (prior actor)',
      chain_note: describeActChainShape(),
    },
  };
}

/**
 * Token expired — token's exp claim is in the past
 *
 * @param {string|number} expiresAt - Token expiration (ISO string or unix timestamp)
 * @returns {object}
 */
function buildTokenExpired(expiresAt) {
  const expDisplay = typeof expiresAt === 'number'
    ? new Date(expiresAt * 1000).toISOString()
    : expiresAt;
  return {
    what_failed: `Token expired at ${expDisplay}. Current server time is past expiration.`,
    why: 'Tokens have a limited lifetime to reduce the blast radius of token theft. If a token is stolen, the attacker can only use it until it expires — not indefinitely.',
    teaching: 'Token expiration is like a session timeout. Short-lived access tokens (15-60 minutes) combined with refresh tokens provide both security and usability. This is standard OAuth 2.0 practice.',
    fix: 'Use your refresh token to obtain a new access token, or re-authenticate with the authorization server.',
    tokens_involved: {
      expired_at: expDisplay,
      current_time: new Date().toISOString(),
    },
  };
}

/**
 * Rate limit exceeded — too many requests in the time window
 *
 * @param {number} limit - Max requests allowed
 * @param {number} current - Current request count
 * @param {number} [windowSec=60] - Rate limit window in seconds
 * @returns {object}
 */
function buildRateLimitExceeded(limit, current, windowSec) {
  const window = windowSec || 60;
  return {
    what_failed: `Rate limit exceeded. Limit: ${limit} requests per ${window} seconds. Current: ${current} requests in window.`,
    why: `Rate limits protect against cascade failures, runaway agent loops, and denial-of-service attacks. If an agent enters an infinite loop making ${current}+ requests, the rate limit acts as a circuit breaker.`,
    teaching: 'Rate limiting is a defense-in-depth mechanism. It ensures that no single client — human or AI agent — can monopolize system resources or cause cascading failures.',
    fix: `Wait for the current rate-limit window to reset (up to ${window} seconds), then retry. If the limit is too restrictive for your use case, contact an administrator.`,
    tokens_involved: {
      rate_limit: limit,
      current_count: current,
      window_seconds: window,
    },
  };
}

/**
 * Insufficient permissions — role-based access denied
 *
 * @param {string} required - Required role (e.g. 'admin')
 * @param {string} actual - Actual role (e.g. 'user')
 * @returns {object}
 */
function buildInsufficientPermissions(required, actual) {
  return {
    what_failed: `Permission denied. Required role: '${required}'. Your role: '${actual}'.`,
    why: `Admin operations are restricted to the '${required}' role to prevent unauthorized system changes. This includes operations like kill switch activation, configuration changes, and user management.`,
    teaching: 'This implements the principle of least privilege: each identity gets only the permissions needed for its role. High-risk admin operations are gated behind explicit role checks to limit blast radius.',
    fix: `Contact your system administrator to have your account upgraded to the '${required}' role, or use an endpoint that matches your current '${actual}' permissions.`,
    tokens_involved: {
      required_role: required,
      actual_role: actual,
    },
  };
}

/**
 * Policy violation — transaction or operational limit exceeded
 *
 * @param {string} policy - Policy name (e.g. 'transaction_limit')
 * @param {string} reason - Human-readable description
 * @returns {object}
 */
function buildPolicyViolation(policy, reason) {
  return {
    what_failed: `Policy violation: ${reason}`,
    why: 'Operational policies define boundaries for what AI agents and users can do. Transaction limits cap the maximum value per operation so that if an agent is compromised, the financial impact is bounded.',
    teaching: 'Policy enforcement is a key AI TRiSM (Trust, Risk, and Security Management) principle. It ensures that automated systems operate within pre-approved boundaries, requiring human review for actions that exceed those limits.',
    fix: 'Reduce the operation to within policy limits, or request a policy exception from an administrator.',
    tokens_involved: {
      policy_name: policy,
      violation_reason: reason,
    },
  };
}

module.exports = {
  describeActChainShape,
  buildTokenTypeMismatch,
  buildScopeViolation,
  buildAudienceMismatch,
  buildDelegationClaimMissing,
  buildTokenExpired,
  buildRateLimitExceeded,
  buildInsufficientPermissions,
  buildPolicyViolation,
};
