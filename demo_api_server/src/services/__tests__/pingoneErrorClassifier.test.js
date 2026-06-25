const PingOneErrorClassifier = require('../pingoneErrorClassifier');

describe('PingOneErrorClassifier', () => {
  describe('TRANSIENT errors', () => {
    it('classifies ECONNREFUSED as TRANSIENT', () => {
      const err = new Error('Connection refused');
      err.code = 'ECONNREFUSED';

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('TRANSIENT');
      expect(result.code).toBe('NETWORK_ERROR');
      expect(result.retryable).toBe(true);
      expect(result.userAction).toBe('retry');
    });

    it('classifies ETIMEDOUT as TRANSIENT', () => {
      const err = new Error('Request timed out');
      err.code = 'ETIMEDOUT';

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('TRANSIENT');
      expect(result.code).toBe('NETWORK_ERROR');
      expect(result.retryable).toBe(true);
    });

    it('classifies HTTP 429 as TRANSIENT', () => {
      const err = new Error('Too many requests');
      err.response = {
        status: 429,
        headers: { 'retry-after': '60' },
        data: {},
      };

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('TRANSIENT');
      expect(result.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(result.retryable).toBe(true);
      expect(result.context.retryAfter).toBe(60);
    });

    it('classifies HTTP 5xx as TRANSIENT', () => {
      const err = new Error('Service unavailable');
      err.response = {
        status: 503,
        data: {},
      };

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('TRANSIENT');
      expect(result.code).toBe('SERVICE_UNAVAILABLE');
      expect(result.retryable).toBe(true);
    });
  });

  describe('USER errors', () => {
    it('classifies invalid_grant as SESSION_EXPIRED', () => {
      const err = new Error('Invalid grant');
      err.response = {
        status: 401,
        data: {
          error: 'invalid_grant',
          error_description: 'The authorization code is invalid',
        },
      };

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('USER');
      expect(result.code).toBe('SESSION_EXPIRED');
      expect(result.retryable).toBe(false);
      expect(result.userAction).toBe('re-auth');
    });

    it('classifies expired token as TOKEN_EXPIRED', () => {
      const err = new Error('jwt expired');

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('USER');
      expect(result.code).toBe('TOKEN_EXPIRED');
      expect(result.userAction).toBe('re-auth');
    });

    it('classifies token revoked', () => {
      const err = new Error('Token revoked');

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('USER');
      expect(result.code).toBe('TOKEN_REVOKED');
      expect(result.userAction).toBe('re-auth');
    });

    it('classifies scope mismatch', () => {
      const err = new Error('Missing scope');
      err.classification = {
        requiredScopes: ['read:users'],
        missingScopes: ['read:users'],
      };

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('USER');
      expect(result.code).toBe('SCOPE_INSUFFICIENT');
      expect(result.userAction).toBe('re-auth');
    });
  });

  describe('CONFIG errors', () => {
    it('classifies audience mismatch', () => {
      const err = new Error('jwt audience invalid');

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('AUDIENCE_MISMATCH');
      expect(result.isConfig).toBe(true);
      expect(result.userAction).toBe('contact-support');
    });

    it('classifies issuer mismatch', () => {
      const err = new Error('jwt issuer invalid');

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('ISSUER_MISMATCH');
      expect(result.isConfig).toBe(true);
    });

    it('classifies JWKS error', () => {
      const err = new Error('Failed to fetch JWKS');

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('JWKS_UNAVAILABLE');
      expect(result.isConfig).toBe(true);
    });

    it('classifies invalid signature', () => {
      const err = new Error('jwt signature is invalid');

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('INVALID_SIGNATURE');
      expect(result.isConfig).toBe(true);
    });

    it('classifies delegation claim missing', () => {
      const err = new Error('Delegation claim missing');

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('DELEGATION_CLAIM_MISSING');
      expect(result.isConfig).toBe(true);
    });

    it('classifies token exchange error', () => {
      const err = new Error('token exchange failed');
      err.response = {
        data: { error: 'invalid_client' },
      };

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('TOKEN_EXCHANGE_FAILED');
      expect(result.isConfig).toBe(true);
    });
  });

  describe('UNKNOWN errors', () => {
    it('classifies null error as UNKNOWN', () => {
      const result = PingOneErrorClassifier.classify(null);

      expect(result.category).toBe('UNKNOWN');
      expect(result.code).toBe('UNKNOWN_ERROR');
      expect(result.retryable).toBe(false);
    });

    it('classifies unrecognized error as UNKNOWN', () => {
      const err = new Error('Something went wrong');

      const result = PingOneErrorClassifier.classify(err);

      expect(result.category).toBe('UNKNOWN');
      expect(result.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('classifyTokenValidationError', () => {
    it('classifies expired token', () => {
      const err = new Error('jwt expired');

      const result = PingOneErrorClassifier.classifyTokenValidationError(err);

      expect(result.category).toBe('USER');
      expect(result.code).toBe('TOKEN_EXPIRED');
    });

    it('classifies invalid signature', () => {
      const err = new Error('jwt signature is invalid');
      const context = { jwksUri: 'https://auth.pingone.com/abc/as/jwks' };

      const result = PingOneErrorClassifier.classifyTokenValidationError(err, context);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('INVALID_SIGNATURE');
      expect(result.context.jwksUri).toBe(context.jwksUri);
    });

    it('classifies audience mismatch', () => {
      const err = new Error('jwt audience invalid');

      const result = PingOneErrorClassifier.classifyTokenValidationError(err);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('AUDIENCE_MISMATCH');
    });

    it('classifies JWKS error', () => {
      const err = new Error('No matching JWKS key found for kid=xyz');

      const result = PingOneErrorClassifier.classifyTokenValidationError(err);

      expect(result.category).toBe('CONFIG');
      expect(result.code).toBe('JWKS_UNAVAILABLE');
    });
  });
});
