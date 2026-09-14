#!/usr/bin/env node
'use strict';

/**
 * Real-jose interop check for signed Agent Cards (A2A v1.0 §8.4).
 *
 * jest.config.js maps `jose` -> a test shim (src/__tests__/__mocks__/jose-cjs.js)
 * repo-wide, so nothing under jest ever proves a card we sign can be verified
 * by an actual external client using the real `jose` library — the whole
 * point of signing cards in the first place. This script is plain Node (not
 * jest), so the shim does not apply: it signs a card through our own
 * CommonJS service, then independently verifies it with the REAL `jose`
 * package (v6, ESM-only — hence this file is .mjs, per-task guidance).
 *
 * Usage: npm run verify:a2a-card-signing
 */

import { createRequire } from 'node:module';
import { flattenedVerify, importJWK } from 'jose';

const require = createRequire(import.meta.url);
const { getSignedCard, publicJwks } = require('../services/a2aCardSigningService');
const { canonicalizeAgentCard } = require('@a2a-js/sdk');

const CFG = { getEffective: (k) => (k === 'PUBLIC_APP_URL' ? 'https://api.ping.demo:3001' : '') };

async function main() {
  const card = await getSignedCard('investment', CFG);
  if (!card?.signatures?.length) {
    throw new Error('getSignedCard produced no signed card');
  }

  const jwk = publicJwks().keys[0];
  const publicKey = await importJWK(jwk, 'EdDSA');

  const payload = Buffer.from(canonicalizeAgentCard(card), 'utf-8').toString('base64url');
  const sig = card.signatures[0];
  const { protectedHeader } = await flattenedVerify(
    { protected: sig.protected, payload, signature: sig.signature },
    publicKey,
  );

  if (protectedHeader.kid !== jwk.kid) {
    throw new Error(`protected header kid ${protectedHeader.kid} != published jwks kid ${jwk.kid}`);
  }

  console.log('OK: real jose (v6) independently verified a card signed by a2aCardSigningService.js');
  console.log(`  alg: ${protectedHeader.alg}`);
  console.log(`  kid: ${protectedHeader.kid}`);
  console.log(`  jku: ${protectedHeader.jku}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
});
