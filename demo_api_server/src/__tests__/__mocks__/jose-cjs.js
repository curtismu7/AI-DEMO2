'use strict';
// CJS shim for jose — jose v6+ ships ESM-only (its package.json "exports" has
// no "require" condition, only "default" pointing at an ESM file), so Jest's
// CJS module loader throws a SyntaxError on `export` when anything requires
// it. No code in this repo requires 'jose' directly; it arrives transitively
// via @a2a-js/sdk's bundled CJS build (dist/index.cjs, dist/server/*.cjs),
// which does `require("jose")` at module scope for its agent-card signature
// helper (mirrors the uuid-cjs.js shim below for the same class of
// ESM-only-dependency problem).
//
// services/a2aCardSigningService.js (A2A v1.0 §8.4 card signing, Task 2 of
// the a2a-hardening plan) DOES exercise real JWS signing/verification now, so
// this shim implements flattened JWS for EdDSA only — the one alg this repo
// signs with (Ed25519 card-signing key). Any other alg throws loudly instead
// of returning silently wrong crypto output.
const crypto = require('node:crypto');

function requireEdDSA(alg, name) {
  if (alg !== 'EdDSA') {
    throw new Error(
      `jose-cjs test shim: "${name}" only implements alg "EdDSA" (got "${alg}") — real JWS signing is not exercised for other algs by this test suite`,
    );
  }
}

const base64url = {
  encode: (input) => Buffer.from(input).toString('base64url'),
  decode: (input) => new Uint8Array(Buffer.from(input, 'base64url')),
};

function decodeProtectedHeader(entry) {
  return JSON.parse(Buffer.from(entry.protected, 'base64url').toString('utf-8'));
}

class FlattenedSign {
  constructor(payload) {
    this._payload = payload;
  }
  setProtectedHeader(header) {
    this._protectedHeader = header;
    return this;
  }
  setUnprotectedHeader(header) {
    this._unprotectedHeader = header;
    return this;
  }
  async sign(key) {
    requireEdDSA(this._protectedHeader?.alg, 'FlattenedSign#sign');
    const protectedB64 = base64url.encode(JSON.stringify(this._protectedHeader));
    const payloadB64 = base64url.encode(this._payload);
    const signingInput = Buffer.from(`${protectedB64}.${payloadB64}`);
    const signature = crypto.sign(null, signingInput, key);
    return {
      protected: protectedB64,
      payload: payloadB64,
      signature: base64url.encode(signature),
      header: this._unprotectedHeader,
    };
  }
}

async function flattenedVerify(jws, key) {
  const header = decodeProtectedHeader(jws);
  requireEdDSA(header.alg, 'flattenedVerify');
  const signingInput = Buffer.from(`${jws.protected}.${jws.payload}`);
  const signature = Buffer.from(jws.signature, 'base64url');
  const ok = crypto.verify(null, signingInput, key, signature);
  if (!ok) {
    throw new Error('jose-cjs test shim: EdDSA signature verification failed');
  }
  return { payload: base64url.decode(jws.payload), protectedHeader: header };
}

module.exports = {
  FlattenedSign,
  flattenedVerify,
  decodeProtectedHeader,
  base64url,
};
