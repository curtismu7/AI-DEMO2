/**
 * validateToken()'s HTTPS-only JWKS guard must stay the default for every
 * caller — the opt-in `allowHttp` exists ONLY for oauth-mcp's own embedded-AS
 * JWKS (internal Docker network, never internet-facing, served over plain
 * HTTP today). Proves: allowHttp lets an http:// JWKS URI through, the
 * default (no allowHttp) still rejects it exactly as before, and allowHttp
 * never weakens the https:// path.
 */
'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const jwt = require('jsonwebtoken');

jest.mock('http');
jest.mock('https');
const http = require('http');
const https = require('https');

const { validateToken } = require('../../services/tokenValidationService');

const KID = 'kid-allow-http-1';

function mockJwksResponse(transport, keys) {
  transport.request.mockImplementation((_options, callback) => {
    const res = new EventEmitter();
    process.nextTick(() => {
      callback(res);
      res.emit('data', JSON.stringify({ keys }));
      res.emit('end');
    });
    return { on: jest.fn(), setTimeout: jest.fn(), end: jest.fn() };
  });
}

describe('tokenValidationService — allowHttp opt-in', () => {
  let privateKey, jwk, token;

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
    token = jwt.sign({ sub: 'oauth-mcp-token' }, privateKey, { algorithm: 'RS256', keyid: KID });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allowHttp:true fetches an http:// JWKS URI over plain HTTP', async () => {
    mockJwksResponse(http, [jwk]);
    const payload = await validateToken(token, {
      jwksUri: 'http://mcp-server:8080/jwks',
      allowHttp: true,
    });
    expect(payload.sub).toBe('oauth-mcp-token');
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(https.request).not.toHaveBeenCalled();
  });

  it('without allowHttp, an http:// JWKS URI is still rejected (unchanged default)', async () => {
    // Distinct URI from the allowHttp:true case above — fetchJwks caches by
    // jwksUri, and the cache check runs before the HTTPS guard, so reusing
    // the same URI would return the earlier test's cached result instead of
    // re-exercising the guard.
    await expect(
      validateToken(token, { jwksUri: 'http://mcp-server:8080/other-jwks' }),
    ).rejects.toThrow(/HTTPS/);
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  it('allowHttp:true does not affect an https:// JWKS URI — still fetched over HTTPS', async () => {
    mockJwksResponse(https, [jwk]);
    const payload = await validateToken(token, {
      jwksUri: 'https://auth.pingone.com/env-123/as/jwks',
      allowHttp: true,
    });
    expect(payload.sub).toBe('oauth-mcp-token');
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(http.request).not.toHaveBeenCalled();
  });
});
