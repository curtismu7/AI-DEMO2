/**
 * MCP Error Formatter Service
 * 
 * Formats error responses in JsonRpc 2.0 format with educational content.
 * Converts generic error codes into structured responses with:
 * - what_failed: What validation failed
 * - why: Security reasoning
 * - teaching: What this teaches about security
 * - fix: How to resolve
 */

/**
 * JsonRpc 2.0 error codes
 * @see https://www.jsonrpc.org/specification#error_object
 */
const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR_START: -32099,
  SERVER_ERROR_END: -32000,
};

/**
 * Error code mapping to JsonRpc codes and HTTP status
 */
const ERROR_MAP = {
  NO_TOKEN: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 401,
    message: 'No token provided',
  },
  TOKEN_TYPE_MISMATCH: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 403,
    message: 'Token type mismatch',
  },
  SCOPE_VIOLATION: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 403,
    message: 'Scope violation',
  },
  AUDIENCE_MISMATCH: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 401,
    message: 'Token audience mismatch',
  },
  DELEGATION_CLAIM_MISSING: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 403,
    message: 'Delegation claim missing',
  },
  TOKEN_EXPIRED: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 401,
    message: 'Token expired',
  },
  RATE_LIMIT_EXCEEDED: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 429,
    message: 'Rate limit exceeded',
  },
  INSUFFICIENT_PERMISSIONS: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 403,
    message: 'Insufficient permissions',
  },
  POLICY_VIOLATION: {
    jsonrpc_code: JSONRPC_ERROR_CODES.INVALID_REQUEST,
    http_status: 403,
    message: 'Policy violation',
  },
};

export default class McpErrorFormatter {
  /**
   * Format error as JsonRpc 2.0 response
   * 
   * @param {object} res - Express response
   * @param {string} errorCode - Error code (e.g., TOKEN_TYPE_MISMATCH)
   * @param {string} message - Human-readable message
   * @param {object} context - Additional context (token info, scopes, etc.)
   */
  static formatMcpError(res, errorCode, message, context = {}) {
    const errorConfig = ERROR_MAP[errorCode] || ERROR_MAP.INVALID_REQUEST;
    const educationalContent = this.getEducationalContent(errorCode, context);

    // JsonRpc 2.0 error response format
    const jsonRpcError = {
      jsonrpc: '2.0',
      id: context.requestId || null,
      error: {
        code: errorConfig.jsonrpc_code,
        message: errorConfig.message,
        data: {
          error_code: errorCode,
          details: {
            what_failed: educationalContent.what_failed,
            why: educationalContent.why,
            teaching: educationalContent.teaching,
            fix: educationalContent.fix,
          },
          context: {
            ...context,
            timestamp: new Date().toISOString(),
          },
        },
      },
    };

    return res.status(errorConfig.http_status).json(jsonRpcError);
  }

  /**
   * Get educational content for error type
   * @private
   */
  static getEducationalContent(errorCode, context) {
    switch (errorCode) {
      case 'NO_TOKEN':
        return {
          what_failed: 'No authentication token provided',
          why: 'MCP tools require authorization. Every request must include a Bearer token in the Authorization header.',
          teaching: 'Authorization is the first security gate. Without proving who you are, the system can\'t verify what you\'re allowed to do.',
          fix: 'Include Authorization header: Authorization: Bearer <your_access_token>',
        };

      case 'TOKEN_TYPE_MISMATCH':
        return {
          what_failed: `Token type mismatch. Required: 'agent', Got: '${context.actual_type || 'unknown'}'`,
          why: `This endpoint requires an agent token for security isolation. User tokens are associated with people and have different permissions. Agent tokens are for AI systems with narrower, agent-specific permissions.`,
          teaching: 'Token types enforce the principle of least privilege. User tokens can\'t be used where agent tokens are required, even if the user is admin. This prevents accidental privilege escalation.',
          fix: 'If you\'re implementing an AI agent, authenticate as the agent using OAuth 2.0 Client Credentials flow (not Authorization Code flow).',
        };

      case 'SCOPE_VIOLATION':
        const missing = context.missing_scopes?.join(', ') || 'mcp:execute';
        return {
          what_failed: `Scope validation failed. Missing: [${missing}]. Your token has: [${(context.actual_scopes || []).join(', ') || 'none'}]`,
          why: `Scopes limit what each token can do, even if the user has unlimited permissions. This endpoint requires '${missing}' scope. Scopes are the primary security boundary for OAuth 2.0 tokens.`,
          teaching: 'Scopes work like permission zones. Your driver\'s license lets you drive, but a restriction says "no highway driving" — that\'s a scope. Your token similarly has zones: can it execute MCP tools? Can it read accounts? Each requires an explicit scope.',
          fix: `Request additional scopes during authentication: [${context.required_scopes?.join(', ') || 'mcp:execute'}]. Add these to your OAuth 2.0 authorization request.`,
        };

      case 'DELEGATION_CLAIM_MISSING':
        return {
          what_failed: 'RFC 8693 delegation claim (\'act\') missing from token',
          why: 'For AI agents to act on behalf of users, they must carry cryptographic proof of delegation (the \'act\' claim). Without it, any agent could claim to act for any user. The \'act\' claim prevents unauthorized delegation and ensures accountability.',
          teaching: 'The \'act\' claim is like a power-of-attorney document in crypto form. It says "I have explicit permission from User X to perform this action." Without it, you\'re just a rogue actor with no accountability.',
          fix: 'Use the RFC 8693 token exchange flow to convert your user\'s token + agent token into a delegation token with the \'act\' claim. Exchange happens at the OAuth 2.0 token endpoint, which validates the delegation relationship first.',
        };

      case 'TOKEN_EXPIRED':
        return {
          what_failed: `Token expired at ${context.expires_at || 'unknown time'}`,
          why: 'Tokens have a limited lifetime for security. If stolen, attackers can only use it during that window. After expiration, the token is useless and re-authentication is required.',
          teaching: 'Token expiration is like a session timeout. If you walk away from your desk, the session times out. OAuth tokens work the same way — they automatically expire.',
          fix: 'Refresh your token using the refresh token grant, or re-authenticate from scratch to get a new access token.',
        };

      case 'RATE_LIMIT_EXCEEDED':
        return {
          what_failed: `Rate limit exceeded. Limit: ${context.limit || 10} requests per 60 seconds. Current: ${context.current || 'unknown'}`,
          why: 'Rate limits protect the system from cascade failures and runaway loops. If an AI agent goes rogue, rate limiting stops it before overwhelming infrastructure.',
          teaching: 'Imagine a busy restaurant: if 1,000 people show up at once, the system breaks. Rate limits are like a reservation system — they distribute load fairly and protect the service.',
          fix: `Wait ${context.recommended_wait_seconds || 30} seconds, then retry. If hitting limits in normal usage, check for infinite retry loops or bugs.`,
        };

      case 'INSUFFICIENT_PERMISSIONS':
        return {
          what_failed: `Permission denied. Required role: ${context.required_role || 'admin'}. Your role: ${context.actual_role || 'user'}`,
          why: `Admin operations are restricted to administrators. Regular users can\'t perform these operations because they\'re high-risk and could damage the system.`,
          teaching: 'You don\'t let every teller at a bank access the vault. Only certain roles (senior managers) get access to high-risk operations.',
          fix: `Contact your system administrator to escalate your account to the ${context.required_role || 'admin'} role.`,
        };

      case 'POLICY_VIOLATION':
        return {
          what_failed: `Policy violation: ${context.reason || 'Unknown'}`,
          why: 'Transaction limits prevent unauthorized large movements. Each AI agent is bounded by limits to contain damage if things go wrong (blast radius containment).',
          teaching: 'Limits are guardrails. They define the maximum risk an agent can take before requiring human review.',
          fix: `Reduce your request to stay within the policy limit. Or request a higher limit from an administrator.`,
        };

      default:
        return {
          what_failed: 'An error occurred',
          why: 'Check documentation for details',
          teaching: 'This is a security checkpoint',
          fix: 'Consult documentation or contact support',
        };
    }
  }

  /**
   * Get all error codes (for introspection/documentation)
   */
  static getAllErrorCodes() {
    return Object.keys(ERROR_MAP);
  }

  /**
   * Get error configuration by code
   */
  static getErrorConfig(errorCode) {
    return ERROR_MAP[errorCode] || ERROR_MAP.INVALID_REQUEST;
  }
}
