/**
 * JWT algorithm-confusion (CWE-347, RS256->HS256 key confusion) regression test.
 *
 * validateToken() (services/tokenValidationService.js) used to build its
 * jwt.verify() `algorithms` allow-list from the TOKEN'S OWN UNVERIFIED header
 * (`alg`) instead of a fixed, server-controlled value. Because the RSA public
 * key used to verify RS256 tokens is — by definition — public (fetched via
 * JWKS), an attacker can:
 *   1. Craft a header {alg: "HS256", kid: "<a real, known kid>"}
 *   2. HMAC-sign the token using the RSA public key's PEM string as the
 *      HMAC secret (also public data)
 *   3. Because the vulnerable code set `algorithms: [alg || 'RS256']`, the
 *      attacker's own header dictated the allow-list, so jsonwebtoken would
 *      HMAC-verify the forgery successfully with arbitrary claims — a full
 *      authentication bypass.
 *
 * This suite proves the forged token is rejected, and that legitimate
 * RS256-signed tokens still verify successfully.
 */
'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const jwt = require('jsonwebtoken');

jest.mock('https');
const https = require('https');

const { validateToken } = require('../../services/tokenValidationService');

const JWKS_URI = 'https://auth.pingone.com/env-123/as/jwks';
const KID = 'kid-alg-confusion-1';

/** Mock https.request(options, cb) to serve a fixed JWKS JSON body. */
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

describe('tokenValidationService — RS256/HS256 algorithm confusion (CWE-347)', () => {
  let publicKey;
  let privateKey;
  let jwk;
  /** The exact PEM string the service derives from the JWK (jwkToPem output equivalent). */
  let servicePem;

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    publicKey = pair.publicKey;
    privateKey = pair.privateKey;
    jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
    // Reproduce the service's jwk -> PEM conversion so the forged HMAC secret
    // matches byte-for-byte what tokenValidationService.js will actually use.
    servicePem = crypto
      .createPublicKey({ key: jwk, format: 'jwk' })
      .export({ type: 'spki', format: 'pem' });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockJwksResponse([jwk]);
  });

  it('REJECTS a forged HS256 token HMAC-signed with the public RSA key PEM (algorithm confusion attack)', async () => {
    const forged = jwt.sign(
      { sub: 'attacker', role: 'admin' },
      servicePem,
      { algorithm: 'HS256', keyid: KID }
    );

    await expect(validateToken(forged, { jwksUri: JWKS_URI })).rejects.toThrow();
  });

  it('still ACCEPTS a legitimate RS256 token signed with the matching private key', async () => {
    const legit = jwt.sign(
      { sub: 'real-user', role: 'customer' },
      privateKey,
      { algorithm: 'RS256', keyid: KID }
    );

    const payload = await validateToken(legit, { jwksUri: JWKS_URI });
    expect(payload.sub).toBe('real-user');
  });

  it('never derives the jwt.verify() algorithms allow-list from the token header — always ["RS256"]', async () => {
    // This is the precise regression test for the code-level defect: the
    // `algorithms` option passed to jwt.verify() must be a fixed value the
    // server controls, not something read from the caller-supplied (and thus
    // unverified) JWT header. Assert it directly, independent of whichever
    // incidental protections a given jsonwebtoken version may also apply.
    const verifySpy = jest.spyOn(jwt, 'verify');

    const forgedHeaderAlg = jwt.sign(
      { sub: 'attacker' },
      servicePem,
      { algorithm: 'HS256', keyid: KID }
    );

    await validateToken(forgedHeaderAlg, { jwksUri: JWKS_URI }).catch(() => {});

    expect(verifySpy).toHaveBeenCalled();
    expect(verifySpy.mock.calls[0][2].algorithms).toEqual(['RS256']);

    verifySpy.mockRestore();
  });
});
