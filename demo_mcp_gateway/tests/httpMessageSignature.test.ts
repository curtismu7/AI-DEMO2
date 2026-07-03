'use strict';

/**
 * RFC 9421 HTTP Message Signatures — canonicalization + Ed25519 verification,
 * validated against the RFC's own Appendix B test material:
 *
 *   - B.1.4  "test-key-ed25519" Ed25519 test key (PEM + JWK)
 *   - B.2    the "test-request" message
 *   - B.2.6  the "sig-b26" Ed25519 signature example
 *
 * Vectors were transcribed verbatim from https://www.rfc-editor.org/rfc/rfc9421.txt
 * (RFC 8792 '\' line-wrapping unwrapped).
 */

import * as crypto from 'crypto';
import {
  parseSignatureInput,
  parseSignatureHeader,
  buildSignatureBase,
  verifyEd25519Signature,
  jwkThumbprint,
  type MessageContext,
} from '../src/httpMessageSignature';

// ── RFC 9421 Appendix B.1.4 — test-key-ed25519 ─────────────────────────────
const ED25519_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJrQLj5P/89iXES9+vFgrIy29clF9CC/oPPsw3c5D0bs=
-----END PUBLIC KEY-----`;

const ED25519_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs',
};

// ── RFC 9421 Appendix B.2 — test-request message ───────────────────────────
// POST /foo?param=Value&Pet=dog HTTP/1.1  (authority example.com)
const TEST_REQUEST: MessageContext = {
  method: 'POST',
  path: '/foo',
  authority: 'example.com',
  headers: {
    host: 'example.com',
    date: 'Tue, 20 Apr 2021 02:07:55 GMT',
    'content-type': 'application/json',
    'content-digest':
      'sha-512=:WZDPaVn/7XgHaAy8pmojAkGWoRx2UFChF41A2svX+TaPm+AbwAgBWnrIiYllu7BNNyealdVLvRwEmTHWXvJwew==:',
    'content-length': '18',
  },
};

// ── RFC 9421 Appendix B.2.6 — Signature-Input / Signature (label sig-b26) ──
const SIG_B26_INPUT =
  'sig-b26=("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"';
const SIG_B26_SIGNATURE =
  'sig-b26=:wqcAqbmYJ2ji2glfAMaRy4gruYYnx2nEFN2HN6jrnDnQCK1u02Gb04v9EDgwUPiu4A0w6vuQv5lIp5WPpBKRCw==:';

// The corresponding signature base printed in B.2.6 (unwrapped):
const SIG_B26_BASE = [
  '"date": Tue, 20 Apr 2021 02:07:55 GMT',
  '"@method": POST',
  '"@path": /foo',
  '"@authority": example.com',
  '"content-type": application/json',
  '"content-length": 18',
  '"@signature-params": ("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"',
].join('\n');

describe('RFC 9421 Signature-Input parsing (sig-b26)', () => {
  it('parses label, covered components, and signature params', () => {
    const entries = parseSignatureInput(SIG_B26_INPUT);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.label).toBe('sig-b26');
    expect(e.components.map((c) => c.name)).toEqual([
      'date', '@method', '@path', '@authority', 'content-type', 'content-length',
    ]);
    expect(e.params.created).toBe(1618884473);
    expect(e.params.keyid).toBe('test-key-ed25519');
    expect(e.params.expires).toBeUndefined();
    expect(e.params.tag).toBeUndefined();
    // rawParams must reproduce the exact member serialization (used verbatim
    // as the "@signature-params" base line).
    expect(e.rawParams).toBe(
      '("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"',
    );
  });

  it('parses the Signature header byte sequence', () => {
    const sigs = parseSignatureHeader(SIG_B26_SIGNATURE);
    const sig = sigs.get('sig-b26');
    expect(sig).toBeDefined();
    expect(sig!.length).toBe(64); // raw Ed25519 signature
  });
});

describe('RFC 9421 signature base construction (B.2.6)', () => {
  it('reproduces the exact signature base printed in the RFC', () => {
    const entry = parseSignatureInput(SIG_B26_INPUT)[0];
    const base = buildSignatureBase(entry, TEST_REQUEST);
    expect(base).toBe(SIG_B26_BASE);
  });

  it('throws on a covered header field missing from the message', () => {
    const entry = parseSignatureInput('sig1=("x-missing");created=1')[0];
    expect(() => buildSignatureBase(entry, TEST_REQUEST)).toThrow(/x-missing/);
  });
});

describe('RFC 9421 Ed25519 verification (B.1.4 key, sig-b26)', () => {
  const pub = crypto.createPublicKey(ED25519_PUBLIC_PEM);

  it('verifies the genuine sig-b26 signature over the test-request', () => {
    const entry = parseSignatureInput(SIG_B26_INPUT)[0];
    const base = buildSignatureBase(entry, TEST_REQUEST);
    const sig = parseSignatureHeader(SIG_B26_SIGNATURE).get('sig-b26')!;
    expect(verifyEd25519Signature(pub, base, sig)).toBe(true);
  });

  it('verifies via the B.1.4 JWK form of the same key', () => {
    const jwkPub = crypto.createPublicKey({ key: ED25519_JWK as crypto.JsonWebKey, format: 'jwk' });
    const entry = parseSignatureInput(SIG_B26_INPUT)[0];
    const base = buildSignatureBase(entry, TEST_REQUEST);
    const sig = parseSignatureHeader(SIG_B26_SIGNATURE).get('sig-b26')!;
    expect(verifyEd25519Signature(jwkPub, base, sig)).toBe(true);
  });

  it('rejects when the signature is tampered', () => {
    const entry = parseSignatureInput(SIG_B26_INPUT)[0];
    const base = buildSignatureBase(entry, TEST_REQUEST);
    const sig = Buffer.from(parseSignatureHeader(SIG_B26_SIGNATURE).get('sig-b26')!);
    sig[0] ^= 0xff;
    expect(verifyEd25519Signature(pub, base, sig)).toBe(false);
  });

  it('rejects when a covered component changes (authority swap)', () => {
    const entry = parseSignatureInput(SIG_B26_INPUT)[0];
    const base = buildSignatureBase(entry, { ...TEST_REQUEST, authority: 'evil.example' });
    const sig = parseSignatureHeader(SIG_B26_SIGNATURE).get('sig-b26')!;
    expect(verifyEd25519Signature(pub, base, sig)).toBe(false);
  });
});

describe('RFC 7638 JWK thumbprint (OKP)', () => {
  it('computes a stable 43-char base64url thumbprint over {crv,kty,x}', () => {
    const t = jwkThumbprint(ED25519_JWK);
    expect(t).toHaveLength(43);
    // Independently computed: SHA-256 over the canonical member JSON.
    const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${ED25519_JWK.x}"}`;
    expect(t).toBe(crypto.createHash('sha256').update(canonical).digest('base64url'));
  });
});
