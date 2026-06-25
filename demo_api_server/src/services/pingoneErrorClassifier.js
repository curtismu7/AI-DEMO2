/**
 * PingOneErrorClassifier — Categorize PingOne API and token validation errors
 *
 * Classifies all auth-related errors into 4 categories for intelligent handling:
 *
 *   1. TRANSIENT: Network timeouts, 5xx, rate limits → retry with backoff
 *   2. USER: Expired token, scope mismatch, revoked → re-authenticate
 *   3. CONFIG: JWKS unreachable, audience mismatch, issuer mismatch → contact support
 *   4. UNKNOWN: Unexpected error structure → log fully, show generic message
 *
 * Each classification includes:
 *   - category: One of the 4 above
 *   - code: Machine-readable error code (TOKEN_EXPIRED, ISSUER_MISMATCH, etc.)
 *   - retryable: Whether the error is transient and worth retrying
 *   - userAction: What the end user should do (re-auth, contact-support, retry, check-status)
 *   - isConfig: If true, error is a system configuration issue (not user-level)
 *   - context: Additional data (URIs, timestamps, etc.) for support/debugging
 */

class PingOneErrorClassifier {
  static classify(err) {
    if (!err) {
      return {
        category: 'UNKNOWN',
        code: 'UNKNOWN_ERROR',
        retryable: false,
        userAction: 'contact-support',
        isConfig: false,
      };
    }

    // Network errors: connection refused, timeout, etc.
    if (this._isNetworkError(err)) {
      return {
        category: 'TRANSIENT',
        code: 'NETWORK_ERROR',
        retryable: true,
        userAction: 'retry',
        isConfig: false,
        context: {
          what: 'Network connectivity issue',
          error: err.code || err.message,
          recoveryStrategy: 'exponential backoff, max 5 retries',
        },
      };
    }

    // HTTP 429: Rate limit exceeded
    if (err.response?.status === 429) {
      const retryAfter = err.response?.headers?.['retry-after'];
      return {
        category: 'TRANSIENT',
        code: 'RATE_LIMIT_EXCEEDED',
        retryable: true,
        userAction: 'retry',
        isConfig: false,
        context: {
          what: 'Rate limit exceeded',
          httpStatus: 429,
          retryAfter: retryAfter ? parseInt(retryAfter) : 60,
          recoveryStrategy: 'exponential backoff with retry-after header',
        },
      };
    }

    // HTTP 5xx: Server errors
    if (err.response?.status >= 500) {
      return {
        category: 'TRANSIENT',
        code: 'SERVICE_UNAVAILABLE',
        retryable: true,
        userAction: 'retry',
        isConfig: false,
        context: {
          what: 'PingOne service unavailable',
          httpStatus: err.response.status,
          recoveryStrategy: 'exponential backoff, check status page',
        },
      };
    }

    // HTTP 401 with invalid_grant: User needs to re-authenticate
    if (
      err.response?.status === 401 &&
      this._isPingOneApiError(err) &&
      err.response?.data?.error === 'invalid_grant'
    ) {
      return {
        category: 'USER',
        code: 'SESSION_EXPIRED',
        retryable: false,
        userAction: 're-auth',
        isConfig: false,
        context: {
          what: 'Invalid or expired grant',
          reason: err.response?.data?.error_description || 'Token no longer valid',
          fix: 'User must re-authenticate to obtain a new token',
        },
      };
    }

    // Token expired
    if (this._isTokenExpired(err)) {
      return {
        category: 'USER',
        code: 'TOKEN_EXPIRED',
        retryable: false,
        userAction: 're-auth',
        isConfig: false,
        context: {
          what: 'Token expired',
          reason: 'Token timestamp (exp) is in the past',
          fix: 'User must refresh or re-authenticate',
        },
      };
    }

    // Token revoked
    if (this._isTokenRevoked(err)) {
      return {
        category: 'USER',
        code: 'TOKEN_REVOKED',
        retryable: false,
        userAction: 're-auth',
        isConfig: false,
        context: {
          what: 'Token revoked',
          reason: 'Introspection indicates token is no longer active',
          fix: 'User must re-authenticate',
        },
      };
    }

    // Scope mismatch
    if (this._isScopeMismatch(err)) {
      const requiredScopes = err.classification?.requiredScopes || [];
      const missingScopes = err.classification?.missingScopes || [];
      return {
        category: 'USER',
        code: 'SCOPE_INSUFFICIENT',
        retryable: false,
        userAction: 're-auth',
        isConfig: false,
        context: {
          what: 'Token missing required scopes',
          requiredScopes,
          missingScopes,
          fix: 'User must re-authenticate with all required scopes',
        },
      };
    }

    // Audience mismatch
    if (this._isAudienceMismatch(err)) {
      return {
        category: 'CONFIG',
        code: 'AUDIENCE_MISMATCH',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
        context: {
          what: 'Token audience does not match endpoint',
          reason: 'Token was issued for a different API/audience',
          fix: 'Verify audience configuration in PINGONE_ENVIRONMENT_ID and application settings',
        },
      };
    }

    // Issuer mismatch
    if (this._isIssuerMismatch(err)) {
      return {
        category: 'CONFIG',
        code: 'ISSUER_MISMATCH',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
        context: {
          what: 'Token issuer does not match expected PingOne environment',
          reason: 'Token (iss claim) issued by different PingOne environment',
          fix: 'Verify PINGONE_ENVIRONMENT_ID env var matches the PingOne environment',
        },
      };
    }

    // JWKS error
    if (this._isJwksError(err)) {
      return {
        category: 'CONFIG',
        code: 'JWKS_UNAVAILABLE',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
        context: {
          what: 'JWKS endpoint unreachable or invalid',
          reason:
            err.response?.status === 404
              ? 'JWKS endpoint returned 404'
              : err.message,
          uri: err.classification?.jwksUri || 'unknown',
          fix: 'Verify PINGONE_ENVIRONMENT_ID is correct and PingOne environment is accessible',
        },
      };
    }

    // Invalid signature
    if (this._isInvalidSignature(err)) {
      return {
        category: 'CONFIG',
        code: 'INVALID_SIGNATURE',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
        context: {
          what: 'JWT signature verification failed',
          reason: 'Token signature does not match JWKS public key',
          fix: 'Verify JWKS_URI or PINGONE_ENVIRONMENT_ID matches token issuer',
        },
      };
    }

    // Delegation claim missing
    if (this._isDelegationMissing(err)) {
      return {
        category: 'CONFIG',
        code: 'DELEGATION_CLAIM_MISSING',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
        context: {
          what: 'Token missing RFC 8693 delegation claim (act)',
          reason: 'Endpoint requires delegation chain but none found in token',
          fix: 'Use RFC 8693 token exchange to mint a delegated token before calling this endpoint',
        },
      };
    }

    // Token exchanger misconfigured
    if (this._isTokenExchangeError(err)) {
      return {
        category: 'CONFIG',
        code: 'TOKEN_EXCHANGE_FAILED',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
        context: {
          what: 'Token exchange failed',
          reason:
            err.response?.data?.error ||
            err.message ||
            'Unknown token exchange error',
          fix: 'Verify PINGONE_TOKEN_EXCHANGER_CLIENT_ID and credentials are configured',
        },
      };
    }

    // Default
    return {
      category: 'UNKNOWN',
      code: 'UNKNOWN_ERROR',
      retryable: false,
      userAction: 'contact-support',
      isConfig: false,
      context: {
        what: 'Unexpected error',
        error: err.message || 'Unknown error',
        suggestion: 'Check system status page or contact support',
      },
    };
  }

  static classifyTokenValidationError(err, context = {}) {
    if (!err) return { category: 'UNKNOWN', code: 'UNKNOWN_ERROR' };

    if (err.message.includes('expired')) {
      return {
        category: 'USER',
        code: 'TOKEN_EXPIRED',
        retryable: false,
        userAction: 're-auth',
        isConfig: false,
      };
    }

    if (err.message.includes('signature') || err.message.includes('invalid token')) {
      return {
        category: 'CONFIG',
        code: 'INVALID_SIGNATURE',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
        context: { jwksUri: context.jwksUri },
      };
    }

    if (err.message.includes('audience') || err.message.includes('aud')) {
      return {
        category: 'CONFIG',
        code: 'AUDIENCE_MISMATCH',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
      };
    }

    if (err.message.includes('issuer') || err.message.includes('iss')) {
      return {
        category: 'CONFIG',
        code: 'ISSUER_MISMATCH',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
      };
    }

    if (err.message.includes('JWKS') || err.message.includes('key') || err.message.includes('No matching')) {
      return {
        category: 'CONFIG',
        code: 'JWKS_UNAVAILABLE',
        retryable: false,
        userAction: 'contact-support',
        isConfig: true,
      };
    }

    return {
      category: 'UNKNOWN',
      code: 'UNKNOWN_ERROR',
      retryable: false,
      userAction: 'contact-support',
      isConfig: false,
    };
  }

  static _isNetworkError(err) {
    const networkCodes = [
      'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'socket hang up',
    ];
    return networkCodes.includes(err.code) || networkCodes.some((code) => err.message?.includes(code));
  }

  static _isPingOneApiError(err) {
    return !!(err.response?.data?.error || err.response?.data?.error_description);
  }

  static _isTokenExpired(err) {
    return err.message?.includes('expired') || err.message?.includes('TokenExpiredError') || err.classification?.code === 'TOKEN_EXPIRED';
  }

  static _isTokenRevoked(err) {
    return err.message?.includes('revoked') || err.message?.includes('active: false') || err.classification?.code === 'TOKEN_REVOKED';
  }

  static _isScopeMismatch(err) {
    return err.message?.includes('scope') || err.classification?.code === 'SCOPE_VIOLATION';
  }

  static _isAudienceMismatch(err) {
    return err.message?.includes('audience') || err.message?.includes('aud') || err.classification?.code === 'AUDIENCE_MISMATCH';
  }

  static _isIssuerMismatch(err) {
    return err.message?.includes('issuer') || err.message?.includes('iss') || err.classification?.code === 'ISSUER_MISMATCH';
  }

  static _isJwksError(err) {
    return err.message?.includes('JWKS') || err.message?.includes('keys') || err.message?.includes('key') || err.message?.includes('No matching') || (err.response?.status === 404 && err.classification?.type === 'JWKS_ERROR');
  }

  static _isInvalidSignature(err) {
    return err.message?.includes('signature') || err.message?.includes('invalid token') || err.message?.includes('JsonWebTokenError');
  }

  static _isDelegationMissing(err) {
    return err.message?.includes('Delegation') || err.message?.includes('act') || err.classification?.code === 'DELEGATION_CLAIM_MISSING';
  }

  static _isTokenExchangeError(err) {
    return err.message?.includes('token exchange') || err.message?.includes('exchanger') || err.response?.data?.error === 'invalid_grant' || err.response?.data?.error === 'invalid_client';
  }
}

module.exports = PingOneErrorClassifier;
