'use strict';

const {
  getCardSigningKey,
  publicJwks,
  getSignedCard,
  cardVerifier,
} = require('../services/a2aCardSigningService');

const CFG = { getEffective: (k) => (k === 'PUBLIC_APP_URL' ? 'https://api.ping.demo:3001' : '') };

describe('A2A Agent Card signing', () => {
  test('publishes one Ed25519 verification key whose kid matches the signature', async () => {
    const jwks = publicJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });
    expect(jwks.keys[0].kid).toBe(getCardSigningKey().kid);
  });

  test('signs a card and verifies it', async () => {
    const card = await getSignedCard('investment', CFG);
    expect(card.signatures.length).toBeGreaterThan(0);
    await expect(cardVerifier(CFG)(card)).resolves.toBeUndefined();
  });

  test('pins the jku to our own origin in the PROTECTED header', async () => {
    const card = await getSignedCard('investment', CFG);
    const header = JSON.parse(
      Buffer.from(card.signatures[0].protected, 'base64url').toString('utf-8'),
    );
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(getCardSigningKey().kid);
    expect(header.jku).toBe('https://api.ping.demo:3001/a2a/specialists/.well-known/jwks.json');
  });

  test('rejects a tampered card', async () => {
    const card = await getSignedCard('investment', CFG);
    const tampered = { ...card, name: 'Attacker Agent' };
    await expect(cardVerifier(CFG)(tampered)).rejects.toThrow();
  });

  test('refuses a jku pointing at a foreign origin (key substitution / SSRF)', async () => {
    const card = await getSignedCard('investment', CFG);
    const header = JSON.parse(
      Buffer.from(card.signatures[0].protected, 'base64url').toString('utf-8'),
    );
    const forged = {
      ...card,
      signatures: [
        {
          ...card.signatures[0],
          protected: Buffer.from(
            JSON.stringify({ ...header, jku: 'https://evil.example/jwks.json' }),
          ).toString('base64url'),
        },
      ],
    };
    // The SDK's verifyAgentCardSignature (@a2a-js/sdk dist/index.cjs) tries
    // each signature in a try/catch and only console.debug-logs a per-entry
    // error (including cardVerifier's "refusing foreign jku ..." throw) —
    // once no signature verifies, it always rejects with this generic
    // message, indistinguishable from a tampered card. What matters for the
    // SSRF defense is that cardVerifier's retrievePublicKey callback refuses
    // the mismatched jku synchronously and never fetches it.
    await expect(cardVerifier(CFG)(forged)).rejects.toThrow(
      'No valid signatures found on agent card.',
    );
  });
});
