'use strict';

/**
 * Web Bot Auth signer (RFC 9421, draft-meunier profile) — BFF side.
 * The gateway-side verifier is validated against the RFC 9421 Appendix B
 * Ed25519 vectors in demo_mcp_gateway/tests/httpMessageSignature.test.ts;
 * this suite pins the signer to the same wire format by independently
 * reconstructing the signature base and verifying with Node crypto.
 */

const crypto = require('node:crypto');
const {
  getWebBotAuthKey,
  signWebBotAuthHeaders,
  jwkThumbprint,
} = require('../../services/dpopKeyService');

const AUTHORITY = 'Gateway.Ping.Demo:3005';
const AGENT = 'https://bff.ping.demo';

describe('getWebBotAuthKey', () => {
  it('returns a stable process-wide Ed25519 (OKP) keypair', () => {
    const k1 = getWebBotAuthKey();
    const k2 = getWebBotAuthKey();
    expect(k2).toBe(k1); // same key every call — the published directory must match
    expect(k1.publicJwk.kty).toBe('OKP');
    expect(k1.publicJwk.crv).toBe('Ed25519');
    expect(typeof k1.publicJwk.x).toBe('string');
    expect(k1.privatePem).toContain('PRIVATE KEY');
  });

  it('uses the RFC 7638 thumbprint over {crv,kty,x} as keyid', () => {
    const k = getWebBotAuthKey();
    const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${k.publicJwk.x}"}`;
    const expected = crypto.createHash('sha256').update(canonical).digest('base64url');
    expect(k.keyid).toBe(expected);
    expect(k.keyid).toHaveLength(43);
    expect(jwkThumbprint(k.publicJwk)).toBe(expected); // shared helper agrees
  });
});

describe('signWebBotAuthHeaders', () => {
  it('emits the profile headers: quoted Signature-Agent, tagged Signature-Input, byte-sequence Signature', () => {
    const h = signWebBotAuthHeaders({ authority: AUTHORITY, signatureAgent: AGENT });
    expect(h['Signature-Agent']).toBe(`"${AGENT}"`);
    expect(h['Signature-Input']).toMatch(
      /^sig1=\("@authority" "signature-agent"\);created=\d+;expires=\d+;keyid="[^"]+";nonce="[^"]+";tag="web-bot-auth"$/,
    );
    expect(h.Signature).toMatch(/^sig1=:[A-Za-z0-9+/]+=*:$/);
    const params = h['Signature-Input'].slice('sig1='.length);
    const created = Number(/created=(\d+)/.exec(params)[1]);
    const expires = Number(/expires=(\d+)/.exec(params)[1]);
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs(created - now)).toBeLessThanOrEqual(5);
    expect(expires - created).toBe(300);
    expect(params).toContain(`keyid="${getWebBotAuthKey().keyid}"`);
  });

  it('signs a base the verifier side can reconstruct (Ed25519 verifies)', () => {
    const h = signWebBotAuthHeaders({ authority: AUTHORITY, signatureAgent: AGENT });
    const params = h['Signature-Input'].slice('sig1='.length);
    // Reconstruct the RFC 9421 signature base exactly as a verifier would:
    // covered components from the message, then the raw @signature-params.
    const base =
      `"@authority": ${AUTHORITY.toLowerCase()}\n` +
      `"signature-agent": ${h['Signature-Agent']}\n` +
      `"@signature-params": ${params}`;
    const sig = Buffer.from(h.Signature.slice('sig1=:'.length, -1), 'base64');
    const pub = crypto.createPublicKey({ key: getWebBotAuthKey().publicJwk, format: 'jwk' });
    expect(sig).toHaveLength(64);
    expect(crypto.verify(null, Buffer.from(base, 'utf-8'), pub, sig)).toBe(true);
    // ...and fails for a different authority (signature actually binds @authority)
    const evil = base.replace(AUTHORITY.toLowerCase(), 'evil.example');
    expect(crypto.verify(null, Buffer.from(evil, 'utf-8'), pub, sig)).toBe(false);
  });

  it('uses a fresh nonce per request (replay protection)', () => {
    const n1 = /nonce="([^"]+)"/.exec(signWebBotAuthHeaders({ authority: AUTHORITY, signatureAgent: AGENT })['Signature-Input'])[1];
    const n2 = /nonce="([^"]+)"/.exec(signWebBotAuthHeaders({ authority: AUTHORITY, signatureAgent: AGENT })['Signature-Input'])[1];
    expect(n1).not.toBe(n2);
  });
});
