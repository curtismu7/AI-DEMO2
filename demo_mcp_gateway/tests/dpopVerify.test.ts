import * as crypto from 'crypto';
import { verifyDpopProof, jwkThumbprint } from '../src/dpopVerify';

// Minimal ES256 DPoP proof signer (mirrors the BFF dpopKeyService) so the test can
// exercise the gateway verifier with real, valid proofs.
function b64url(input: crypto.BinaryLike): string {
  return Buffer.from(input as Buffer).toString('base64url');
}
function makeKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicJwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
  return { privateKey, publicJwk, jkt: jwkThumbprint(publicJwk) };
}
function signProof(
  key: ReturnType<typeof makeKey>,
  opts: { htu: string; htm?: string; ath?: string; iat?: number; jti?: string },
): string {
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk };
  const payload = {
    htu: opts.htu,
    htm: (opts.htm ?? 'POST').toUpperCase(),
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
    jti: opts.jti ?? crypto.randomUUID(),
    ...(opts.ath ? { ath: opts.ath } : {}),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: key.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${b64url(sig)}`;
}
const ath = (t: string) => crypto.createHash('sha256').update(t).digest('base64url');

describe('verifyDpopProof (RFC 9449)', () => {
  const TOKEN = 'access-token-abc';

  it('accepts a valid, key-bound proof', () => {
    const k = makeKey();
    const proof = signProof(k, { htu: 'https://gw/mcp', ath: ath(TOKEN) });
    const r = verifyDpopProof({ proof, htu: '/mcp', htm: 'POST', accessToken: TOKEN, expectedJkt: k.jkt });
    expect(r.ok).toBe(true);
    expect(r.jkt).toBe(k.jkt);
  });

  it('rejects when the token is bound to a different key (jkt mismatch)', () => {
    const k = makeKey();
    const other = makeKey();
    const proof = signProof(k, { htu: 'https://gw/mcp', ath: ath(TOKEN) });
    const r = verifyDpopProof({ proof, htu: '/mcp', htm: 'POST', accessToken: TOKEN, expectedJkt: other.jkt });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/jkt/);
  });

  it('rejects a proof reused with a different bearer (ath mismatch)', () => {
    const k = makeKey();
    const proof = signProof(k, { htu: 'https://gw/mcp', ath: ath(TOKEN) });
    const r = verifyDpopProof({ proof, htu: '/mcp', htm: 'POST', accessToken: 'stolen-token', expectedJkt: k.jkt });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ath mismatch');
  });

  it('rejects a replayed jti', () => {
    const k = makeKey();
    const proof = signProof(k, { htu: 'https://gw/mcp', ath: ath(TOKEN) });
    const first = verifyDpopProof({ proof, htu: '/mcp', htm: 'POST', accessToken: TOKEN, expectedJkt: k.jkt });
    const second = verifyDpopProof({ proof, htu: '/mcp', htm: 'POST', accessToken: TOKEN, expectedJkt: k.jkt });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('jti replay');
  });

  it('rejects a tampered signature', () => {
    const k = makeKey();
    const proof = signProof(k, { htu: 'https://gw/mcp', ath: ath(TOKEN) });
    const parts = proof.split('.');
    // Mutate to a character the signature does NOT already end with. Hardcoding
    // 'AA' made this test fail roughly once in 4096 runs: when the real
    // signature happened to end in 'AA' the "forged" proof was byte-identical to
    // the valid one, so it verified and ok came back true. Seen in CI
    // 2026-08-18. A security test that occasionally reports a forgery as
    // accepted teaches people to re-run it.
    const tail = parts[2].slice(-2);
    const forged = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}${tail === 'AA' ? 'BB' : 'AA'}`;
    expect(forged).not.toBe(proof);
    const r = verifyDpopProof({ proof: forged, htu: '/mcp', htm: 'POST', accessToken: TOKEN, expectedJkt: k.jkt });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad signature');
  });

  it('rejects an htm mismatch', () => {
    const k = makeKey();
    const proof = signProof(k, { htu: 'https://gw/mcp', htm: 'POST', ath: ath(TOKEN) });
    const r = verifyDpopProof({ proof, htu: '/mcp', htm: 'GET', accessToken: TOKEN, expectedJkt: k.jkt });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('htm mismatch');
  });

  it('rejects an expired iat outside the window', () => {
    const k = makeKey();
    const proof = signProof(k, { htu: 'https://gw/mcp', ath: ath(TOKEN), iat: Math.floor(Date.now() / 1000) - 600 });
    const r = verifyDpopProof({ proof, htu: '/mcp', htm: 'POST', accessToken: TOKEN, expectedJkt: k.jkt, maxAgeSecs: 60 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('iat outside window');
  });

  it('rejects a missing proof', () => {
    const r = verifyDpopProof({ proof: '', htu: '/mcp', htm: 'POST' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing proof');
  });
});
