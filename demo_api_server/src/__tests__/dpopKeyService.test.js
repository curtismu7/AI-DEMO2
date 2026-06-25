'use strict';

const crypto = require('node:crypto');
const {
  generateDpopKeypair,
  jwkThumbprint,
  accessTokenHash,
  signDpopProof,
} = require('../../services/dpopKeyService');

describe('dpopKeyService (RFC 9449 signer)', () => {
  it('generates a P-256 keypair with a 43-char base64url thumbprint', () => {
    const kp = generateDpopKeypair();
    expect(kp.publicJwk.kty).toBe('EC');
    expect(kp.publicJwk.crv).toBe('P-256');
    expect(typeof kp.privatePem).toBe('string');
    expect(kp.privatePem).toContain('PRIVATE KEY');
    expect(kp.jkt).toHaveLength(43); // SHA-256 (32 bytes) base64url
    expect(kp.jkt).toBe(jwkThumbprint(kp.publicJwk));
  });

  it('signs a DPoP proof that verifies against the embedded JWK', () => {
    const kp = generateDpopKeypair();
    const proof = signDpopProof({
      privatePem: kp.privatePem,
      publicJwk: kp.publicJwk,
      htu: 'https://gw/mcp',
      htm: 'post',
      ath: accessTokenHash('tok'),
    });
    const [h, p, s] = proof.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());

    expect(header.typ).toBe('dpop+jwt');
    expect(header.alg).toBe('ES256');
    expect(payload.htm).toBe('POST'); // upper-cased
    expect(payload.htu).toBe('https://gw/mcp');
    expect(typeof payload.jti).toBe('string');
    expect(payload.ath).toBe(accessTokenHash('tok'));

    const pub = crypto.createPublicKey({ key: header.jwk, format: 'jwk' });
    const ok = crypto.verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: pub, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    );
    expect(ok).toBe(true);
    expect(jwkThumbprint(header.jwk)).toBe(kp.jkt);
  });

  it('produces a unique jti per proof', () => {
    const kp = generateDpopKeypair();
    const mk = () => JSON.parse(Buffer.from(
      signDpopProof({ privatePem: kp.privatePem, publicJwk: kp.publicJwk, htu: 'https://gw/mcp' }).split('.')[1],
      'base64url',
    ).toString()).jti;
    expect(mk()).not.toBe(mk());
  });
});
