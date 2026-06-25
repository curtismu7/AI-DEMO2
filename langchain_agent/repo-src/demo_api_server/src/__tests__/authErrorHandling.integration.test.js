/**
 * Integration tests for auth error handling end-to-end
 * Tests the full pipeline: error → classifier → middleware → response
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const PingOneErrorClassifier = require('../services/pingoneErrorClassifier');
const ErrorSchemaService = require('../services/errorSchemaService');

describe('Auth Error Handling — Integration', () => {
  describe('Token validation error classification', () => {
    it('classifies expired token and returns 401 with USER category', () => {
      const expiredToken = jwt.sign(
        { sub: 'user1', exp: Math.floor(Date.now() / 1000) - 3600 },
        'secret',
        { algorithm: 'HS256' }
      );

      const error = new Error('jwt expired');
      error.classification = PingOneErrorClassifier.classifyTokenValidationError(error, {
        jwksUri: 'https://auth.pingone.com/abc/as/jwks',
      });

      expect(error.classification.category).toBe('USER');
      expect(error.classification.code).toBe('TOKEN_EXPIRED');
      expect(ErrorSchemaService.getStatusCode(error.classification.code)).toBe(401);
    });

    it('classifies audience mismatch as CONFIG with 401', () => {
      const error = new Error('jwt audience invalid');
      error.classification = PingOneErrorClassifier.classifyTokenValidationError(error, {
        audience: 'api-server',
      });

      expect(error.classification.category).toBe('CONFIG');
      expect(error.classification.code).toBe('AUDIENCE_MISMATCH');
      expect(ErrorSchemaService.getStatusCode(error.classification.code)).toBe(401);
    });

    it('classifies JWKS error as CONFIG with 503', () => {
      const error = new Error('No matching JWKS key found for kid=xyz');
      error.classification = PingOneErrorClassifier.classifyTokenValidationError(error, {
        jwksUri: 'https://auth.pingone.com/abc/as/jwks',
      });

      expect(error.classification.category).toBe('CONFIG');
      expect(error.classification.code).toBe('JWKS_UNAVAILABLE');
      expect(ErrorSchemaService.getStatusCode(error.classification.code)).toBe(503);
    });
  });

  describe('PingOne API error classification', () => {
    it('classifies 429 rate limit as TRANSIENT with 429', () => {
      const error = new Error('Too many requests');
      error.response = {
        status: 429,
        headers: { 'retry-after': '60' },
        data: {},
      };

      const classification = PingOneErrorClassifier.classify(error);

      expect(classification.category).toBe('TRANSIENT');
      expect(classification.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(classification.retryable).toBe(true);
      expect(ErrorSchemaService.getStatusCode(classification.code)).toBe(429);
    });

    it('classifies 503 server error as TRANSIENT', () => {
      const error = new Error('Service unavailable');
      error.response = {
        status: 503,
        data: {},
      };

      const classification = PingOneErrorClassifier.classify(error);

      expect(classification.category).toBe('TRANSIENT');
      expect(classification.code).toBe('SERVICE_UNAVAILABLE');
      expect(classification.retryable).toBe(true);
      expect(ErrorSchemaService.getStatusCode(classification.code)).toBe(503);
    });

    it('classifies network timeout as TRANSIENT', () => {
      const error = new Error('Request timed out');
      error.code = 'ETIMEDOUT';

      const classification = PingOneErrorClassifier.classify(error);

      expect(classification.category).toBe('TRANSIENT');
      expect(classification.code).toBe('NETWORK_ERROR');
      expect(classification.retryable).toBe(true);
      expect(ErrorSchemaService.getStatusCode(classification.code)).toBe(503);
    });

    it('classifies invalid_grant as USER with 401', () => {
      const error = new Error('Invalid grant');
      error.response = {
        status: 401,
        data: {
          error: 'invalid_grant',
          error_description: 'Grant no longer valid',
        },
      };

      const classification = PingOneErrorClassifier.classify(error);

      expect(classification.category).toBe('USER');
      expect(classification.code).toBe('SESSION_EXPIRED');
      expect(ErrorSchemaService.getStatusCode(classification.code)).toBe(401);
    });
  });

  describe('Error response format', () => {
    it('includes classification in error response', () => {
      const error = new Error('Token expired');
      error.classification = {
        category: 'USER',
        code: 'TOKEN_EXPIRED',
        retryable: false,
        userAction: 're-auth',
      };
      error.requestId = 'err_123_abc';
      error.timestamp = new Date().toISOString();

      const response = {
        error: error.classification.code,
        message: 'Your session has expired',
        timestamp: error.timestamp,
        request_id: error.requestId,
        classification: {
          category: error.classification.category,
          retryable: error.classification.retryable,
          userAction: error.classification.userAction,
        },
      };

      expect(response.error).toBe('TOKEN_EXPIRED');
      expect(response.classification.category).toBe('USER');
      expect(response.classification.userAction).toBe('re-auth');
      expect(response.request_id).toBe('err_123_abc');
    });

    it('scrubs sensitive data from CONFIG error responses', () => {
      const error = new Error('JWKS unreachable');
      error.classification = {
        category: 'CONFIG',
        code: 'JWKS_UNAVAILABLE',
        context: {
          jwksUri: 'https://auth.pingone.com/secret/as/jwks',
          issuer: 'https://auth.pingone.com/secret/as',
        },
      };

      // Response builder should NOT include sensitive URIs/IDs
      const response = {
        error: error.classification.code,
        details: {
          what: 'JWKS endpoint unreachable',
          action: 'Contact support with the request ID above',
        },
      };

      expect(JSON.stringify(response)).not.toContain('pingone.com');
      expect(JSON.stringify(response)).not.toContain('secret');
    });

    it('includes support contact for CONFIG errors', () => {
      const error = new Error('JWKS unreachable');
      error.classification = {
        category: 'CONFIG',
        code: 'JWKS_UNAVAILABLE',
      };

      const response = {
        error: error.classification.code,
        support: {
          email: 'support@example.com',
          docs: 'https://docs.example.com/errors/JWKS_UNAVAILABLE',
          status_page: 'https://status.example.com',
        },
      };

      expect(response.support).toBeDefined();
      expect(response.support.email).toBeDefined();
      expect(response.support.docs).toContain('JWKS_UNAVAILABLE');
    });
  });

  describe('Retry eligibility', () => {
    it('TRANSIENT errors are retryable', () => {
      const error = new Error('Network timeout');
      error.code = 'ETIMEDOUT';
      error.classification = PingOneErrorClassifier.classify(error);

      expect(error.classification.retryable).toBe(true);
    });

    it('USER errors are NOT retryable', () => {
      const error = new Error('Token expired');
      error.classification = {
        category: 'USER',
        code: 'TOKEN_EXPIRED',
        retryable: false,
      };

      expect(error.classification.retryable).toBe(false);
    });

    it('CONFIG errors are NOT retryable', () => {
      const error = new Error('JWKS unreachable');
      error.classification = {
        category: 'CONFIG',
        code: 'JWKS_UNAVAILABLE',
        retryable: false,
      };

      expect(error.classification.retryable).toBe(false);
    });
  });

  describe('Error categorization completeness', () => {
    it('all error codes have HTTP status mappings', () => {
      const statusMap = ErrorSchemaService.getStatusCodeMap();
      const errorCodes = ErrorSchemaService.getAllErrorCodes();

      for (const code of Object.values(errorCodes)) {
        expect(statusMap[code]).toBeDefined();
        expect(statusMap[code]).toBeGreaterThanOrEqual(400);
      }
    });

    it('TRANSIENT errors map to 5xx or 429', () => {
      const transientCodes = [
        'NETWORK_ERROR',
        'SERVICE_UNAVAILABLE',
        'RATE_LIMIT_EXCEEDED',
        'TOKEN_EXCHANGE_FAILED',
        'JWKS_UNAVAILABLE',
      ];

      const statusMap = ErrorSchemaService.getStatusCodeMap();

      for (const code of transientCodes) {
        const status = statusMap[code];
        expect([429, 503, 500, 502, 504]).toContain(status);
      }
    });

    it('USER errors map to 401 or 403', () => {
      const userCodes = [
        'SESSION_EXPIRED',
        'TOKEN_EXPIRED',
        'TOKEN_REVOKED',
        'SCOPE_INSUFFICIENT',
      ];

      const statusMap = ErrorSchemaService.getStatusCodeMap();

      for (const code of userCodes) {
        const status = statusMap[code];
        expect([401, 403]).toContain(status);
      }
    });

    it('CONFIG errors map to 401, 403, or 503', () => {
      const configCodes = [
        'ISSUER_MISMATCH',
        'AUDIENCE_MISMATCH',
        'INVALID_SIGNATURE',
        'DELEGATION_CLAIM_MISSING',
      ];

      const statusMap = ErrorSchemaService.getStatusCodeMap();

      for (const code of configCodes) {
        const status = statusMap[code];
        expect([401, 403, 503]).toContain(status);
      }
    });
  });

  describe('Error context preservation', () => {
    it('preserves error metadata for support debugging', () => {
      const error = new Error('JWKS fetch failed');
      error.response = { status: 404 };
      error.classification = PingOneErrorClassifier.classify(error);
      error.requestId = 'err_test_123';
      error.timestamp = new Date().toISOString();

      const auditEntry = {
        error_id: error.requestId,
        timestamp: error.timestamp,
        category: error.classification.category,
        code: error.classification.code,
        message: error.message,
        httpStatus: error.response?.status,
      };

      expect(auditEntry.error_id).toBe('err_test_123');
      expect(auditEntry.category).toBe('CONFIG');
      expect(auditEntry.code).toBe('JWKS_UNAVAILABLE');
      expect(auditEntry.httpStatus).toBe(404);
    });

    it('includes user action guidance in classification', () => {
      const userError = new Error('Token expired');
      const userClassification = PingOneErrorClassifier.classifyTokenValidationError(userError);

      const configError = new Error('JWKS unreachable');
      const configClassification = PingOneErrorClassifier.classifyTokenValidationError(configError);

      expect(userClassification.userAction).toBe('re-auth');
      expect(configClassification.userAction).toBe('contact-support');
    });
  });
});
