/**
 * finding #54: jwkToPem() re-derives the PEM from the same JWK on every
 * validateToken() call even though the underlying JWKS is cached for 10
 * minutes. Proves the PEM export itself is now cached per (jwksUri, kid),
 * so a second validateToken() call within the JWKS cache window does not
 * re-run crypto.createPublicKey for a key it already exported.
 */
'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const jwt = require('jsonwebtoken');

jest.mock('https');
const https = require('https');

const { validateToken } = require('../../services/tokenValidationService');

const KID = 'kid-pem-cache-1';
const JWKS_URI = 'https://auth.pingone.com/env-pem-cache/as/jwks';

function mockJwksResponse(keys) {
  https.request.mockImplementation((_options, callback) => {
    const res = new EventEmitter();
    process.nextTick(() => {
      callback(res);
      res.emit('data', JSON.stringify({ keys }));
      res.emit('end');
    });
    return { on: jest.fn(), setTimeout: jest.fn(), end: jest.fn() };
  });
}

describe('tokenValidationService — PEM export caching', () => {
  let privateKey, jwk, token;

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
    token = jwt.sign({ sub: 'user-1' }, privateKey, { algorithm: 'RS256', keyid: KID });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockJwksResponse([jwk]);
  });

  it('derives the PEM once, then reuses it across repeat validateToken calls for the same kid', async () => {
    const createPublicKeySpy = jest.spyOn(crypto, 'createPublicKey');

    const first = await validateToken(token, { jwksUri: JWKS_URI });
    const second = await validateToken(token, { jwksUri: JWKS_URI });

    expect(first.sub).toBe('user-1');
    expect(second.sub).toBe('user-1');
    // JWKS itself is only fetched once (10-minute cache) — already-proven behavior.
    expect(https.request).toHaveBeenCalledTimes(1);
    // The PEM export must not re-run for the second call.
    expect(createPublicKeySpy).toHaveBeenCalledTimes(1);

    createPublicKeySpy.mockRestore();
  });
});
