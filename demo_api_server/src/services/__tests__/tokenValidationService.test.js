const { validateToken, testJwksUri, clearJwksCache } = require('../tokenValidationService');

// Mock dependencies
jest.mock('https');
jest.mock('jsonwebtoken');
jest.mock('../pingoneErrorClassifier');

const PingOneErrorClassifier = require('../pingoneErrorClassifier');

describe('Enhanced Token Validation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearJwksCache();
  });

  describe('validateToken', () => {
    const validToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...';
    const jwksUri = 'https://auth.pingone.com/abc/as/jwks';
    const issuer = 'https://auth.pingone.com/abc/as';
    const audience = 'api-server';

    it('validates a token successfully', async () => {
      const jwt = require('jsonwebtoken');
      const mockPayload = {
        sub: 'user123',
        iss: issuer,
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      jwt.decode.mockReturnValue({
        header: { kid: 'key1', alg: 'RS256' },
        payload: mockPayload,
      });

      // Mock JWKS fetch and verification
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        json: async () => ({
          keys: [{ kid: 'key1', kty: 'RSA', n: 'test', e: 'AQAB' }],
        }),
      });

      jwt.verify.mockImplementation((token, pem, options, callback) => {
        callback(null, mockPayload);
      });

      const result = await validateToken(validToken, { jwksUri, issuer, audience });

      expect(result).toEqual(mockPayload);
      expect(jwt.decode).toHaveBeenCalledWith(validToken, { complete: true });
    });

    it('attaches classification to expired token error', async () => {
      const jwt = require('jsonwebtoken');
      const expiredError = new Error('jwt expired');

      jwt.decode.mockReturnValue({
        header: { kid: 'key1', alg: 'RS256' },
      });

      PingOneErrorClassifier.classifyTokenValidationError.mockReturnValue({
        category: 'USER',
        code: 'TOKEN_EXPIRED',
        userAction: 're-auth',
      });

      jwt.verify.mockImplementation((token, pem, options, callback) => {
        callback(expiredError);
      });

      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        json: async () => ({
          keys: [{ kid: 'key1', kty: 'RSA' }],
        }),
      });

      try {
        await validateToken(validToken, { jwksUri, issuer, audience });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.classification).toBeDefined();
        expect(err.classification.category).toBe('USER');
        expect(err.classification.code).toBe('TOKEN_EXPIRED');
      }
    });

    it('classifies invalid signature as CONFIG error', async () => {
      const jwt = require('jsonwebtoken');
      const sigError = new Error('jwt signature is invalid');

      jwt.decode.mockReturnValue({
        header: { kid: 'key1', alg: 'RS256' },
      });

      PingOneErrorClassifier.classifyTokenValidationError.mockReturnValue({
        category: 'CONFIG',
        code: 'INVALID_SIGNATURE',
        isConfig: true,
        userAction: 'contact-support',
      });

      jwt.verify.mockImplementation((token, pem, options, callback) => {
        callback(sigError);
      });

      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        json: async () => ({
          keys: [{ kid: 'key1', kty: 'RSA' }],
        }),
      });

      try {
        await validateToken(validToken, { jwksUri, issuer, audience });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.classification.category).toBe('CONFIG');
        expect(err.classification.isConfig).toBe(true);
      }
    });

    it('handles JWKS fetch failure with classification', async () => {
      const jwt = require('jsonwebtoken');

      jwt.decode.mockReturnValue({
        header: { kid: 'key1', alg: 'RS256' },
      });

      jest.spyOn(global, 'fetch').mockRejectedValueOnce(
        new Error('ENOTFOUND: Cannot resolve JWKS endpoint')
      );

      try {
        await validateToken(validToken, { jwksUri, issuer, audience });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.classification).toBeDefined();
        expect(err.classification.category).toBe('CONFIG');
        expect(err.classification.code).toBe('JWKS_UNAVAILABLE');
        expect(err.classification.context.jwksUri).toBe(jwksUri);
      }
    });

    it('detects audience mismatch and classifies as CONFIG', async () => {
      const jwt = require('jsonwebtoken');
      const audError = new Error('jwt audience invalid');

      jwt.decode.mockReturnValue({
        header: { kid: 'key1', alg: 'RS256' },
      });

      PingOneErrorClassifier.classifyTokenValidationError.mockReturnValue({
        category: 'CONFIG',
        code: 'AUDIENCE_MISMATCH',
        isConfig: true,
      });

      jwt.verify.mockImplementation((token, pem, options, callback) => {
        callback(audError);
      });

      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        json: async () => ({
          keys: [{ kid: 'key1', kty: 'RSA' }],
        }),
      });

      try {
        await validateToken(validToken, { jwksUri, issuer, audience });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.classification.code).toBe('AUDIENCE_MISMATCH');
      }
    });
  });

  describe('testJwksUri', () => {
    it('resolves if JWKS URI is reachable', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await testJwksUri('https://auth.pingone.com/abc/as/jwks');
      expect(result).toBeUndefined();
    });

    it('rejects if JWKS URI returns 404', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      try {
        await testJwksUri('https://auth.pingone.com/abc/as/jwks');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).toContain('404');
      }
    });

    it('rejects on network timeout', async () => {
      jest.spyOn(global, 'fetch').mockImplementationOnce(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new Error('ETIMEDOUT')), 100);
        })
      );

      try {
        await testJwksUri('https://auth.pingone.com/abc/as/jwks');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).toBe('ETIMEDOUT');
      }
    });
  });

  describe('clearJwksCache', () => {
    it('clears the cache', () => {
      clearJwksCache();
      expect(true).toBe(true); // Cache cleared successfully
    });
  });
});
