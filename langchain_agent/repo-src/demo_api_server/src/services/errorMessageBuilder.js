/**
 * ErrorMessageBuilder — Educational content for security errors
 * 
 * Builds "what_failed", "why", "teaching", "fix" content for each error type.
 * Makes security failures into teaching moments for developers and operators.
 */

export default class ErrorMessageBuilder {
  static describeActChainShape() {
    return "RFC 8693 delegation chains use act.sub for the current actor and nest prior actors under act.act.sub when PingOne preserves the full chain.";
  }

  /**
   * Token Type Mismatch: User token when agent token required (or vice versa)
   */
  static buildTokenTypeMismatch(requiredType, actualType, scopes = []) {
    return {
      what_failed: `Token type validation failed. Expected ${requiredType} token, got ${actualType || 'unknown'} token.`,
      why: `This endpoint requires a ${requiredType} token for security isolation. User tokens are associated with people and have user-scoped permissions. Agent tokens are for AI systems and have narrower agent-specific permissions. Mixing them bypasses security isolation and role-based access controls.`,
      teaching: `Token types enforce the principle of least privilege. User tokens can't be used where agent tokens are required, even if the user is admin. This prevents accidental privilege escalation and keeps agent actions accountable.`,
      fix: `If you're implementing an AI agent, authenticate as the agent (OAuth 2.0 Client Credentials flow). If you're making a user request, use your user credentials (OAuth 2.0 Authorization Code + PKCE flow).`,
      token_type_required: requiredType,
      token_type_actual: actualType,
    };
  }

  /**
   * Scope Violation: Token missing required scopes
   */
  static buildScopeViolation(requiredScopes, actualScopes) {
    const missing = requiredScopes.filter(r => !actualScopes.includes(r));
    return {
      what_failed: `Scope validation failed. Required scopes: [${requiredScopes.join(', ')}]. Your token has: [${actualScopes.join(', ')}].`,
      why: `Scopes limit what each token can do, even if the user has unlimited permissions. This endpoint requires ${missing.length} scope(s) you don't have: [${missing.join(', ')}]. Scopes are the primary security boundary for OAuth 2.0 tokens.`,
      teaching: `Scopes work like permission zones. Your driver's license proves you can drive, but a license restriction might say "no highway driving" — that's a scope. Your token similarly has zones: can it read accounts? Transfer funds? Manage agents? Each requires an explicit scope.`,
      fix: `Re-authenticate and request additional scopes: [${missing.join(', ')}]. In the OAuth 2.0 flow, add these scopes to your authorization request. If using Client Credentials, verify your application has been granted these scopes by an administrator.`,
      required_scopes: requiredScopes,
      actual_scopes: actualScopes,
      missing_scopes: missing,
    };
  }

  /**
   * Audience Mismatch: Token for wrong API endpoint
   */
  static buildAudienceMismatch(tokenAudience, expectedAudience) {
    return {
      what_failed: `Token audience mismatch. Token was issued for: ${tokenAudience}. This endpoint requires: ${expectedAudience}.`,
      why: `Tokens are "bound" to specific API endpoints (the audience claim). If a token is stolen, the attacker can ONLY use it on the intended endpoint, not on other APIs. This is called audience binding or API scoping. It prevents token reuse attacks.`,
      teaching: `Imagine a hotel key card — it's bound to your room number. Even if someone steals it, they can't use it on the 6th floor or at another hotel. OAuth 2.0 tokens work the same way with the 'aud' (audience) claim.`,
      fix: `Get a new token from the correct OAuth 2.0 authorization server. Verify you're calling the right API endpoint. If you're an API gateway or proxy, ensure the audience claim is correctly set when requesting tokens.`,
      token_audience: tokenAudience,
      expected_audience: expectedAudience,
    };
  }

  /**
   * Delegation Claim Missing: No 'act' claim in agent delegation token
   */
  static buildDelegationClaimMissing(context = {}) {
    return {
      what_failed: `Delegation claim ('act') missing from token. Endpoint ${context.method || 'unknown'} ${context.endpoint || 'unknown'} requires a verifiable delegation chain.`,
      why: `For AI agents to safely act on behalf of users, the exchanged token must carry cryptographic delegation proof in the RFC 8693 'act' claim. Without it, the server cannot distinguish a valid on-behalf-of chain from an untrusted direct call.`,
      teaching: `The 'act' claim is a signed chain-of-custody. In the simple path, act.sub identifies the current actor. In the full 2-exchange path, prior actors can be nested under act.act.sub. Missing 'act' means the chain never started.`,
      fix: `Use RFC 8693 token exchange to mint a delegated token before calling this endpoint. For 1-exchange, the result should contain act.sub for the current exchanger. For full 2-exchange, PingOne may preserve a nested chain such as act.sub=<MCP service> and act.act.sub=<AI agent>.`,
      tokens_involved: {
        endpoint: context.endpoint || 'unknown',
        method: context.method || 'unknown',
        expected_claim_shape: 'act.sub (current actor), optional act.act.sub (prior actor)',
        chain_note: this.describeActChainShape(),
      },
    };
  }

  /**
   * Token Expired: Token timestamps passed current time
   */
  static buildTokenExpired(expirationTime) {
    const now = new Date();
    const expired = new Date(expirationTime);
    const minutesAgo = Math.round((now - expired) / (1000 * 60));
    return {
      what_failed: `Token expired at ${expirationTime}. Current time: ${now.toISOString()}. Expired ${minutesAgo} minute(s) ago.`,
      why: `Tokens have a limited lifetime for security. If a token is stolen, the attacker can only use it for that window. After expiration, the token is useless and you must re-authenticate. This limits the blast radius of a stolen token.`,
      teaching: `Token expiration is like a session timeout on a computer. If you walk away from your desk, the session times out to prevent someone else from using your account. OAuth tokens work the same way — they automatically expire.`,
      fix: `Refresh your token using the refresh token grant (if you have a refresh token), or re-authenticate from scratch with your OAuth 2.0 provider to get a new access token.`,
      token_expired_at: expirationTime,
      minutes_expired: minutesAgo,
    };
  }

  /**
   * Rate Limit Exceeded: Too many requests in time window
   */
  static buildRateLimitExceeded(limit, current, windowSeconds = 60) {
    const waitTime = Math.ceil(Math.random() * (windowSeconds / 2));
    return {
      what_failed: `Rate limit exceeded. Limit: ${limit} requests per ${windowSeconds}s. You have: ${current} in the last ${windowSeconds}s.`,
      why: `Rate limits protect the system from cascade failures and runaway loops. If an AI agent goes rogue (spinning in a loop), rate limiting prevents it from overwhelming the infrastructure. Rate limits enforce a circuit breaker pattern.`,
      teaching: `Imagine a busy restaurant: if 1,000 people show up at once without reservations, the system breaks. Rate limits are like a reservation system — they distribute load fairly and protect the service from being overloaded by one customer.`,
      fix: `Wait ${waitTime} seconds, then retry your request. If you're hitting rate limits in normal usage, your integration may have a bug (e.g., retry loop without backoff). Check for infinite retries or loops. For legitimate high-volume needs, contact support to discuss rate limit adjustments.`,
      request_limit: limit,
      current_requests: current,
      window_seconds: windowSeconds,
      recommended_wait_seconds: waitTime,
    };
  }

  /**
   * Insufficient Permissions: User role doesn't have permission for admin operations
   */
  static buildInsufficientPermissions(requiredRole, actualRole) {
    return {
      what_failed: `Permission denied for operation. Required role: ${requiredRole}. Your role: ${actualRole}.`,
      why: `Admin operations (kill switch, config changes, user management) are restricted to administrators. Regular users can't perform these operations because they're high-risk. This enforces the principle of least privilege and limits who can damage the system.`,
      teaching: `You don't let every teller at a bank access the vault. Only certain roles (senior managers, security officers) get access to high-risk operations. OAuth scopes and roles work the same way.`,
      fix: `Contact your system administrator to have your account upgraded to the ${requiredRole} role. Or, request permission to delegate this operation to an admin (they can perform it on your behalf).`,
      required_role: requiredRole,
      actual_role: actualRole,
    };
  }

  /**
   * Policy Violation: Transaction limit or business rule breach
   */
  static buildPolicyViolation(policyName, reason, limit = null) {
    return {
      what_failed: `Policy violation: ${reason}. Policy: ${policyName}.${limit ? ` Limit: ${limit}.` : ''}`,
      why: `Transaction limits prevent unauthorized large movements of money or data. Each AI agent is bounded by transaction limits as a safety mechanism. If something goes wrong (e.g., a buggy agent), limits contain the damage. This is "blast radius containment."`,
      teaching: `Limits are guardrails. They define the maximum risk an agent can take before requiring human review. If a self-driving car starts behaving badly, we want it to fail safely — not accelerate to 120 mph.`,
      fix: `Reduce your request to stay within the policy limit. Or, request a higher limit from an administrator (they may require additional approval or security checks). For critical operations, request human-in-the-loop approval instead of a limit increase.`,
      policy_name: policyName,
      reason,
      limit,
    };
  }

  /**
   * Helper: Get all error builders as a map
   */
  static getAllBuilders() {
    return {
      TOKEN_TYPE_MISMATCH: this.buildTokenTypeMismatch,
      SCOPE_VIOLATION: this.buildScopeViolation,
      AUDIENCE_MISMATCH: this.buildAudienceMismatch,
      DELEGATION_CLAIM_MISSING: this.buildDelegationClaimMissing,
      TOKEN_EXPIRED: this.buildTokenExpired,
      RATE_LIMIT_EXCEEDED: this.buildRateLimitExceeded,
      INSUFFICIENT_PERMISSIONS: this.buildInsufficientPermissions,
      POLICY_VIOLATION: this.buildPolicyViolation,
    };
  }
}
