'use strict';

const crypto = require('node:crypto');
const {
  generateDpopKeypair,
  jwkThumbprint,
  accessTokenHash,
  signDpopProof,
  getSessionDpopKey,
  peekSessionDpopKey,
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

/**
 * The per-session keypair is held in this process, keyed by session id — NOT on
 * req.session. Stored there, the first token exchange of a session mutated the
 * session, so express-session wrote that request's whole start-of-request copy
 * back when it ended: a mode change made while that exchange ran was undone.
 * Reproduced live 2026-09-12 against a session whose first exchange WAS the
 * spanning request (REGRESSION_PLAN §4 — same last-write-wins class as
 * /api/agent/run and the agent-token cache before it).
 */
describe('dpopKeyService — per-session key, off the session', () => {
  const reqFor = (id) => ({ session: { id } });

  it('returns a key without writing it onto the session', () => {
    const req = reqFor('s-dpop-1');
    const key = getSessionDpopKey(req);
    expect(key.jkt).toHaveLength(43);
    expect(req.session.dpopKey).toBeUndefined();
    expect(Object.keys(req.session)).toEqual(['id']);
  });

  it('returns the SAME key for the same session id', () => {
    // The delegated token is bound to this key (cnf.jkt); a second key would
    // sign proofs the gateway cannot match to the token it was issued against.
    const first = getSessionDpopKey(reqFor('s-dpop-stable'));
    const second = getSessionDpopKey(reqFor('s-dpop-stable'));
    expect(second.jkt).toBe(first.jkt);
    expect(second.privatePem).toBe(first.privatePem);
  });

  it('gives different sessions different keys', () => {
    const a = getSessionDpopKey(reqFor('s-dpop-a'));
    const b = getSessionDpopKey(reqFor('s-dpop-b'));
    expect(b.jkt).not.toBe(a.jkt);
  });

  it('peek returns null before a mint and the key after — it never mints', () => {
    // mcpToolPipeline reads the key only when the token exchange already minted
    // one ("never create one here"), so the read path must not create.
    const req = reqFor('s-dpop-peek');
    expect(peekSessionDpopKey(req.session)).toBeNull();
    const minted = getSessionDpopKey(req);
    expect(peekSessionDpopKey(req.session).jkt).toBe(minted.jkt);
  });

  it('no session, or a session with no id, yields null and never throws', () => {
    expect(getSessionDpopKey(null)).toBeNull();
    expect(getSessionDpopKey({})).toBeNull();
    expect(getSessionDpopKey({ session: {} })).toBeNull();
    expect(peekSessionDpopKey(null)).toBeNull();
    expect(peekSessionDpopKey({})).toBeNull();
  });
});
